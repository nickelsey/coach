import Foundation
import GRDB
import Testing
@testable import Coach

struct FastRepositoryTests {
    let db: AppDatabase
    let repo: FastRepository

    init() throws {
        db = try AppDatabase.inMemory()
        repo = FastRepository(database: db)
    }

    func pending() throws -> [String] {
        try db.writer.read { try $0.pendingIDs(Fast.entity) }
    }

    @Test func startCreatesActiveFastAndQueuesIt() throws {
        let fast = try repo.start(goalSeconds: 16 * 3600)
        let active = try db.writer.read { try Fast.active($0) }
        #expect(active == fast)
        #expect(try pending() == [fast.id])
    }

    @Test func onlyOneActiveFast() throws {
        try repo.start(goalSeconds: 3600)
        #expect(throws: FastError.self) { try repo.start(goalSeconds: 3600) }
    }

    @Test func endClearsActiveAndBumpsUpdatedAt() throws {
        let fast = try repo.start(goalSeconds: 3600)
        try repo.end(fast.id)
        let stored = try #require(try db.writer.read { try Fast.fetchOne($0, key: fast.id) })
        #expect(stored.endedAt != nil)
        #expect(stored.updatedAt > fast.updatedAt)
        #expect(try db.writer.read { try Fast.active($0) } == nil)
    }

    @Test func endNeverPrecedesStart() throws {
        let start = Date.nowMillis
        let fast = try repo.start(goalSeconds: 3600, at: start)
        try repo.end(fast.id, at: start.addingTimeInterval(-60))
        let stored = try #require(try db.writer.read { try Fast.fetchOne($0, key: fast.id) })
        #expect(stored.endedAt == start)
    }

    @Test func goalAndDeleteSync() throws {
        let fast = try repo.start(goalSeconds: 3600)
        try repo.setGoal(fast.id, seconds: 18 * 3600)
        try repo.delete(fast.id)
        let stored = try #require(try db.writer.read { try Fast.fetchOne($0, key: fast.id) })
        #expect(stored.goalSeconds == 18 * 3600)
        #expect(stored.deletedAt != nil)
        #expect(try pending() == [fast.id])
    }

    @Test func nilColumnsAreWrittenAsNull() throws {
        // Ending then un-ending (as a sync from another device could) must clear the column.
        let fast = try repo.start(goalSeconds: 3600)
        try repo.end(fast.id)
        try db.writer.write { db in
            var f = try #require(try Fast.fetchOne(db, key: fast.id))
            f.endedAt = nil
            try f.update(db)
        }
        #expect(try db.writer.read { try Fast.active($0) }?.id == fast.id)
    }
}
