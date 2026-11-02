import Foundation
import GRDB

/// The on-device SQLite database. Tables mirror the server's, plus two local
/// bookkeeping tables: `pending_change` (records not yet pushed) and
/// `sync_state` (the pull cursor and similar).
final class AppDatabase: Sendable {
    let writer: any DatabaseWriter

    init(_ writer: any DatabaseWriter) throws {
        self.writer = writer
        try Self.migrator.migrate(writer)
    }

    /// The app's database in Application Support.
    static func onDisk() throws -> AppDatabase {
        let dir = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true)
        let pool = try DatabasePool(path: dir.appending(path: "coach.sqlite").path)
        return try AppDatabase(pool)
    }

    /// A throwaway database for tests and previews.
    static func inMemory() throws -> AppDatabase {
        try AppDatabase(DatabaseQueue())
    }

    private static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1") { db in
            // Timestamps are integer milliseconds since 1970 (see Date.epochMillis).
            try db.create(table: "fast") { t in
                t.primaryKey("id", .text)
                t.column("started_at", .integer).notNull()
                t.column("ended_at", .integer)
                t.column("goal_seconds", .integer).notNull()
                t.column("notes", .text).notNull().defaults(to: "")
                t.column("created_at", .integer).notNull()
                t.column("updated_at", .integer).notNull()
                t.column("deleted_at", .integer)
                t.column("origin", .text).notNull()
                t.column("server_seq", .integer)
            }
            try db.create(index: "fast_active", on: "fast", columns: ["ended_at", "deleted_at"])

            try db.create(table: "pending_change") { t in
                t.column("entity", .text).notNull()
                t.column("record_id", .text).notNull()
                t.primaryKey(["entity", "record_id"])
            }

            try db.create(table: "sync_state") { t in
                t.primaryKey("key", .text)
                t.column("value", .text).notNull()
            }
        }

        return migrator
    }
}

// MARK: - Sync bookkeeping

extension Database {
    /// Marks a record as changed locally so the next sync pushes it.
    func markPending(_ entity: String, id: String) throws {
        try execute(
            sql: "INSERT OR IGNORE INTO pending_change (entity, record_id) VALUES (?, ?)",
            arguments: [entity, id])
    }

    func clearPending(_ entity: String, id: String) throws {
        try execute(
            sql: "DELETE FROM pending_change WHERE entity = ? AND record_id = ?",
            arguments: [entity, id])
    }

    func pendingIDs(_ entity: String) throws -> [String] {
        try String.fetchAll(
            self, sql: "SELECT record_id FROM pending_change WHERE entity = ?",
            arguments: [entity])
    }

    func syncValue(_ key: String) throws -> String? {
        try String.fetchOne(self, sql: "SELECT value FROM sync_state WHERE key = ?", arguments: [key])
    }

    func setSyncValue(_ key: String, _ value: String) throws {
        try execute(
            sql: """
                INSERT INTO sync_state (key, value) VALUES (?, ?)
                ON CONFLICT (key) DO UPDATE SET value = excluded.value
                """,
            arguments: [key, value])
    }
}
