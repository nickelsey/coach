import Foundation
import GRDB
import Observation

/// App-wide state the views read: the running fast, sync status and the
/// selected tab. Writes go through the repository; the view state updates
/// from database observation, so changes that arrive by sync show up too.
@MainActor
@Observable
final class AppModel {
    enum Tab: String, CaseIterable, Identifiable {
        case today, train, fuel, body
        var id: String { rawValue }
        var title: String { rawValue.uppercased() }
    }

    enum SyncStatus: Equatable {
        case notConfigured
        case idle
        case syncing
        case ok(Date)
        case failed(String)
    }

    var tab: Tab = .today
    private(set) var activeFast: Fast?
    private(set) var syncStatus: SyncStatus = .idle
    private(set) var lastError: String?
    private(set) var server: ServerConfig

    let database: AppDatabase
    private let fasts: FastRepository
    private let engine: SyncEngine
    private let configStore: ServerConfigStore
    private let notifications: FastNotifications
    private let makeTransport: @Sendable (ServerConfig) throws -> any SyncTransport

    private var started = false
    private var syncing = false
    private var syncAgain = false
    private var pendingSync: Task<Void, Never>?

    init(
        database: AppDatabase,
        configStore: ServerConfigStore = ServerConfigStore(),
        notifications: FastNotifications = FastNotifications(),
        makeTransport: @escaping @Sendable (ServerConfig) throws -> any SyncTransport = { try HTTPTransport(config: $0) }
    ) {
        self.database = database
        self.fasts = FastRepository(database: database)
        self.engine = SyncEngine(database: database)
        self.configStore = configStore
        self.notifications = notifications
        self.makeTransport = makeTransport
        self.server = configStore.load()
        if !server.isComplete { syncStatus = .notConfigured }
    }

    /// Starts observing the database. Call once, from the root view's task.
    func start() async {
        guard !started else { return }
        started = true
        scheduleSync(after: .zero)

        let observation = ValueObservation.tracking { db in try Fast.active(db) }
        do {
            for try await fast in observation.values(in: database.writer) {
                activeFast = fast
                await notifications.reschedule(for: fast)
            }
        } catch {
            lastError = "Database observation failed: \(error.localizedDescription)"
        }
    }

    // MARK: Fasting

    func startFast(goalHours: Int) {
        perform {
            try fasts.start(goalSeconds: goalHours * 3600)
            Task { await notifications.requestAuthorization() }
        }
    }

    func endFast() {
        guard let id = activeFast?.id else { return }
        perform { try fasts.end(id) }
    }

    func setGoal(hours: Int) {
        guard let id = activeFast?.id else { return }
        perform { try fasts.setGoal(id, seconds: hours * 3600) }
    }

    func alertPreferencesChanged() {
        Task { await notifications.reschedule(for: activeFast) }
    }

    private func perform(_ change: () throws -> Void) {
        do {
            try change()
            lastError = nil
            scheduleSync()
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: Sync

    func updateServer(_ config: ServerConfig) {
        configStore.save(config)
        server = configStore.load()
        syncStatus = server.isComplete ? .idle : .notConfigured
        scheduleSync(after: .zero)
    }

    /// Checks the address and token without syncing.
    func testConnection() async -> String {
        do {
            let transport = try HTTPTransport(config: server)
            try await transport.check()
            return "LINK OK"
        } catch {
            return error.localizedDescription
        }
    }

    /// Debounced so a burst of edits becomes one sync.
    func scheduleSync(after delay: Duration = .seconds(1)) {
        pendingSync?.cancel()
        pendingSync = Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await syncNow()
        }
    }

    func syncNow() async {
        guard server.isComplete else {
            syncStatus = .notConfigured
            return
        }
        // One sync at a time; a request during a sync runs right after it.
        guard !syncing else {
            syncAgain = true
            return
        }
        syncing = true
        defer { syncing = false }

        repeat {
            syncAgain = false
            syncStatus = .syncing
            do {
                let transport = try makeTransport(server)
                _ = try await engine.run(transport)
                syncStatus = .ok(.now)
            } catch {
                syncStatus = .failed(error.localizedDescription)
            }
        } while syncAgain
    }
}
