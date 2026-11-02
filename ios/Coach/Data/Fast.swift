import Foundation
import GRDB

/// One fasting period. `endedAt` is nil while it's running.
///
/// The same struct is the database row and the sync wire format; the coding
/// keys match the server's JSON field names.
struct Fast: Codable, Equatable, Identifiable, Sendable {
    static let entity = "fasts"

    var id: String
    var startedAt: Date
    var endedAt: Date?
    var goalSeconds: Int
    var notes: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?
    var origin: String
    var serverSeq: Int64?

    enum CodingKeys: String, CodingKey {
        case id, notes, origin
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case goalSeconds = "goal_seconds"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
    }

    var isActive: Bool { endedAt == nil && deletedAt == nil }

    func elapsed(at now: Date) -> TimeInterval {
        (endedAt ?? now).timeIntervalSince(startedAt)
    }

    var goalDate: Date { startedAt.addingTimeInterval(TimeInterval(goalSeconds)) }
}

// Explicit row mapping so nil optionals are written as NULL on update.
extension Fast: FetchableRecord, PersistableRecord {
    static let databaseTableName = "fast"

    init(row: Row) throws {
        id = row["id"]
        startedAt = Date(epochMillis: row["started_at"])
        endedAt = (row["ended_at"] as Int64?).map(Date.init(epochMillis:))
        goalSeconds = row["goal_seconds"]
        notes = row["notes"]
        createdAt = Date(epochMillis: row["created_at"])
        updatedAt = Date(epochMillis: row["updated_at"])
        deletedAt = (row["deleted_at"] as Int64?).map(Date.init(epochMillis:))
        origin = row["origin"]
        serverSeq = row["server_seq"]
    }

    func encode(to container: inout PersistenceContainer) throws {
        container["id"] = id
        container["started_at"] = startedAt.epochMillis
        container["ended_at"] = endedAt?.epochMillis
        container["goal_seconds"] = goalSeconds
        container["notes"] = notes
        container["created_at"] = createdAt.epochMillis
        container["updated_at"] = updatedAt.epochMillis
        container["deleted_at"] = deletedAt?.epochMillis
        container["origin"] = origin
        container["server_seq"] = serverSeq
    }

    /// The running fast, if any.
    static func active(_ db: Database) throws -> Fast? {
        try Fast
            .filter(Column("ended_at") == nil && Column("deleted_at") == nil)
            .order(Column("started_at").desc)
            .fetchOne(db)
    }
}

extension Date {
    /// Now, at whole-millisecond precision. Every timestamp the app writes
    /// goes through this so it survives SQLite (integer ms), JSON (3 digits)
    /// and Postgres (µs) round trips exactly, which last-writer-wins
    /// comparisons rely on.
    static var nowMillis: Date { Date().truncatedToMillis }

    /// Rounds to the nearest millisecond. Rounding (not flooring) keeps this
    /// idempotent: k/1000 as a Double can sit just below k ms, and flooring
    /// it again would lose a millisecond.
    var truncatedToMillis: Date { Date(epochMillis: epochMillis) }

    var epochMillis: Int64 { Int64((timeIntervalSince1970 * 1000).rounded()) }

    init(epochMillis: Int64) {
        self.init(timeIntervalSince1970: Double(epochMillis) / 1000)
    }
}
