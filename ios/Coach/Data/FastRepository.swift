import Foundation
import GRDB

enum FastError: LocalizedError {
    case alreadyActive
    case notFound

    var errorDescription: String? {
        switch self {
        case .alreadyActive: "A fast is already running."
        case .notFound: "That fast no longer exists."
        }
    }
}

/// Local writes for fasts. Every change bumps `updated_at` and queues the
/// record for the next push.
struct FastRepository: Sendable {
    let database: AppDatabase
    var origin = "phone"

    @discardableResult
    func start(goalSeconds: Int, at start: Date = .nowMillis) throws -> Fast {
        try database.writer.write { db in
            if try Fast.active(db) != nil { throw FastError.alreadyActive }
            let now = Date.nowMillis
            let fast = Fast(
                id: UUID().uuidString.lowercased(), startedAt: start.truncatedToMillis,
                endedAt: nil, goalSeconds: goalSeconds, notes: "",
                createdAt: now, updatedAt: now, deletedAt: nil, origin: origin, serverSeq: nil)
            try fast.insert(db)
            try db.markPending(Fast.entity, id: fast.id)
            return fast
        }
    }

    func end(_ id: String, at end: Date = .nowMillis) throws {
        try modify(id) { fast in
            fast.endedAt = max(end.truncatedToMillis, fast.startedAt)
        }
    }

    func setGoal(_ id: String, seconds: Int) throws {
        try modify(id) { $0.goalSeconds = seconds }
    }

    /// Soft delete: the tombstone syncs so other devices drop it too.
    func delete(_ id: String) throws {
        try modify(id) { $0.deletedAt = .nowMillis }
    }

    private func modify(_ id: String, _ change: @Sendable (inout Fast) -> Void) throws {
        try database.writer.write { db in
            guard var fast = try Fast.fetchOne(db, key: id) else { throw FastError.notFound }
            change(&fast)
            // Strictly newer, even within the same millisecond: the server
            // ignores pushes whose updated_at isn't greater than its copy.
            fast.updatedAt = max(Date.nowMillis, fast.updatedAt.addingTimeInterval(0.001))
            fast.origin = origin
            try fast.update(db)
            try db.markPending(Fast.entity, id: fast.id)
        }
    }
}
