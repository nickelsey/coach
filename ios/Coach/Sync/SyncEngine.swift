import Foundation
import GRDB

/// One sync pass: push queued local changes, then pull everything newer than
/// the stored cursor.
///
/// Conflicts resolve last-writer-wins on `updated_at`, the same rule the
/// server applies, so both sides converge on the same record.
struct SyncEngine: Sendable {
    let database: AppDatabase
    var pushBatchSize = 200
    var pullPageSize = 500

    struct Report: Equatable, Sendable {
        var pushed = 0
        var pulled = 0
    }

    private static let cursorKey = "cursor"

    func run(_ transport: some SyncTransport) async throws -> Report {
        var report = Report()
        report.pushed = try await push(transport)
        report.pulled = try await pull(transport)
        return report
    }

    private func push(_ transport: some SyncTransport) async throws -> Int {
        var total = 0
        // Bounded so a record that keeps changing can't loop forever.
        for _ in 0..<50 {
            let batch = try await database.writer.read { [pushBatchSize] db in
                let ids = Array(try db.pendingIDs(Fast.entity).prefix(pushBatchSize))
                return try Fast.filter(keys: ids).fetchAll(db)
            }
            if batch.isEmpty {
                // Drop queue entries whose record no longer exists.
                try await database.writer.write { db in
                    for id in try db.pendingIDs(Fast.entity) where try !Fast.exists(db, key: id) {
                        try db.clearPending(Fast.entity, id: id)
                    }
                }
                break
            }

            _ = try await transport.push(Changes(fasts: batch))
            total += batch.count

            // Applied and stale both leave the queue: a stale record means the
            // server has something newer, which the pull brings down. Only
            // clear entries the user hasn't edited again since we read them.
            try await database.writer.write { db in
                for sent in batch {
                    let current = try Fast.fetchOne(db, key: sent.id)
                    if current?.updatedAt == sent.updatedAt {
                        try db.clearPending(Fast.entity, id: sent.id)
                    }
                }
            }
            if batch.count < pushBatchSize { break }
        }
        return total
    }

    private func pull(_ transport: some SyncTransport) async throws -> Int {
        var total = 0
        var cursor = try await database.writer.read { db in
            try db.syncValue(Self.cursorKey).flatMap(Int64.init) ?? 0
        }
        while true {
            let page = try await transport.pull(since: cursor, limit: pullPageSize)
            try await database.writer.write { db in
                for remote in page.changes.fasts {
                    try Self.merge(remote, db)
                }
                try db.setSyncValue(Self.cursorKey, String(page.cursor))
            }
            total += page.changes.fasts.count
            cursor = page.cursor
            if !page.hasMore { break }
        }
        return total
    }

    private static func merge(_ remote: Fast, _ db: Database) throws {
        guard let local = try Fast.fetchOne(db, key: remote.id) else {
            try remote.insert(db)
            return
        }
        if local.updatedAt >= remote.updatedAt {
            // Ours is as new or newer; keep it (it's queued if it needs pushing).
            return
        }
        try remote.update(db)
        // A queued local edit that lost to a newer remote one shouldn't be pushed.
        try db.clearPending(Fast.entity, id: remote.id)
    }
}
