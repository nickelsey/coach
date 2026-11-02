import Foundation
import GRDB
import Testing
@testable import Coach

/// In-memory stand-in for the server, applying the same last-writer-wins rule.
actor FakeServer: SyncTransport {
    private(set) var rows: [String: Fast] = [:]
    private(set) var seqByID: [String: Int64] = [:]
    private(set) var pushes: [Changes] = []
    private var seq: Int64 = 0
    var duringPush: (@Sendable () async throws -> Void)?

    func setDuringPush(_ hook: (@Sendable () async throws -> Void)?) { duringPush = hook }

    /// A write made by another client (e.g. the web app).
    func remoteWrite(_ fast: Fast) { store(fast) }

    func push(_ changes: Changes) async throws -> PushResult {
        pushes.append(changes)
        try await duringPush?()
        var result = PushResult(applied: [], stale: [])
        for f in changes.fasts {
            if let existing = rows[f.id], existing.updatedAt >= f.updatedAt {
                result.stale.append(f.id)
            } else {
                store(f)
                result.applied.append(f.id)
            }
        }
        return result
    }

    func pull(since cursor: Int64, limit: Int) async throws -> PullResult {
        let newer = rows.values
            .filter { seqByID[$0.id]! > cursor }
            .sorted { seqByID[$0.id]! < seqByID[$1.id]! }
        let page = Array(newer.prefix(limit))
        return PullResult(
            changes: Changes(fasts: page),
            cursor: page.last.map { seqByID[$0.id]! } ?? cursor,
            hasMore: newer.count > limit)
    }

    private func store(_ fast: Fast) {
        seq += 1
        var f = fast
        f.serverSeq = seq
        rows[f.id] = f
        seqByID[f.id] = seq
    }
}

func makeFast(_ id: String, updated: Date, goal: Int = 3600) -> Fast {
    Fast(
        id: id, startedAt: updated, endedAt: nil, goalSeconds: goal, notes: "",
        createdAt: updated, updatedAt: updated, deletedAt: nil, origin: "web", serverSeq: nil)
}

struct SyncEngineTests {
    let db: AppDatabase
    let repo: FastRepository
    let server = FakeServer()

    init() throws {
        db = try AppDatabase.inMemory()
        repo = FastRepository(database: db)
    }

    var engine: SyncEngine { SyncEngine(database: db) }

    func local(_ id: String) throws -> Fast? {
        try db.writer.read { try Fast.fetchOne($0, key: id) }
    }

    func pending() throws -> [String] {
        try db.writer.read { try $0.pendingIDs(Fast.entity) }
    }

    @Test func pushesPendingAndClearsQueue() async throws {
        let fast = try repo.start(goalSeconds: 3600)
        let report = try await engine.run(server)
        #expect(report.pushed == 1)
        #expect(await server.rows[fast.id]?.goalSeconds == 3600)
        #expect(try pending().isEmpty)

        // Nothing queued: the next sync pushes nothing.
        _ = try await engine.run(server)
        #expect(await server.pushes.count == 1)
    }

    @Test func editDuringPushStaysQueued() async throws {
        let fast = try repo.start(goalSeconds: 3600)
        let repo = self.repo
        await server.setDuringPush { try repo.setGoal(fast.id, seconds: 7200) }

        _ = try await engine.run(server)
        #expect(try pending() == [fast.id], "the edit made mid-push must still be pushed")

        await server.setDuringPush(nil)
        _ = try await engine.run(server)
        #expect(await server.rows[fast.id]?.goalSeconds == 7200)
        #expect(try pending().isEmpty)
    }

    @Test func pullsRemoteRecordsAndAdvancesCursor() async throws {
        let id = "00000000-0000-4000-8000-000000000001"
        await server.remoteWrite(makeFast(id, updated: .nowMillis))

        let report = try await engine.run(server)
        #expect(report.pulled == 1)
        #expect(try local(id) != nil)

        // Cursor stored: a second sync pulls nothing new.
        #expect(try await engine.run(server).pulled == 0)
    }

    @Test func newerRemoteEditWinsAndDropsQueuedLocalEdit() async throws {
        let fast = try repo.start(goalSeconds: 3600)
        _ = try await engine.run(server)

        try repo.setGoal(fast.id, seconds: 7200) // local edit, queued
        var remote = try #require(try local(fast.id))
        remote.goalSeconds = 36000
        remote.updatedAt = remote.updatedAt.addingTimeInterval(60) // later than the local edit
        await server.remoteWrite(remote)

        _ = try await engine.run(server)
        #expect(try local(fast.id)?.goalSeconds == 36000)
        #expect(await server.rows[fast.id]?.goalSeconds == 36000)
        #expect(try pending().isEmpty)
    }

    @Test func olderRemoteCopyDoesNotOverwriteLocal() async throws {
        let fast = try repo.start(goalSeconds: 3600)
        _ = try await engine.run(server)
        try repo.setGoal(fast.id, seconds: 7200)

        _ = try await engine.run(server)
        #expect(try local(fast.id)?.goalSeconds == 7200)
        #expect(await server.rows[fast.id]?.goalSeconds == 7200)
    }

    @Test func pagesThroughLargePulls() async throws {
        let base = Date.nowMillis
        for i in 1...7 {
            await server.remoteWrite(makeFast(
                String(format: "00000000-0000-4000-8000-%012d", i), updated: base))
        }
        var engine = self.engine
        engine.pullPageSize = 3
        #expect(try await engine.run(server).pulled == 7)
        #expect(try await db.writer.read { try Fast.fetchCount($0) } == 7)
    }
}

struct FastNotificationTests {
    @Test func alertsFollowPreferences() throws {
        let defaults = try #require(UserDefaults(suiteName: "FastNotificationTests"))
        defaults.removePersistentDomain(forName: "FastNotificationTests")
        defaults.set(true, forKey: Prefs.alertGoal)
        defaults.set(true, forKey: Prefs.alertHourBefore)
        defaults.set(true, forKey: Prefs.alertEvery4h)

        let start = Date.nowMillis
        let fast = makeFast("00000000-0000-4000-8000-000000000009", updated: start, goal: 16 * 3600)
        let alerts = FastNotifications.alerts(for: fast, defaults: defaults)
        #expect(alerts.map(\.id) == ["goal", "t-1h", "h4", "h8", "h12"])
        #expect(alerts[0].date == start.addingTimeInterval(16 * 3600))
        #expect(alerts[1].date == start.addingTimeInterval(15 * 3600))

        defaults.set(false, forKey: Prefs.alertEvery4h)
        defaults.set(false, forKey: Prefs.alertHourBefore)
        #expect(FastNotifications.alerts(for: fast, defaults: defaults).map(\.id) == ["goal"])
    }
}
