import Foundation
import Testing
@testable import Coach

struct WireFormatTests {
    @Test(arguments: [
        ("2026-10-27T16:30:00Z", 0.0),
        ("2026-10-27T16:30:00.123Z", 0.123),
        ("2026-10-27T16:30:00.123456Z", 0.123456),
        ("2026-10-27T16:30:00.123456789Z", 0.123456789),
    ])
    func parsesGoTimestamps(input: String, fraction: Double) throws {
        let date = try #require(Wire.parse(input))
        let base = try Date("2026-10-27T16:30:00Z", strategy: .iso8601)
        #expect(abs(date.timeIntervalSince(base) - fraction) < 1e-6)
    }

    @Test func parsesOffsets() throws {
        let utc = try #require(Wire.parse("2026-10-27T16:30:00Z"))
        let offset = try #require(Wire.parse("2026-10-27T18:30:00.000+02:00"))
        #expect(utc == offset)
    }

    @Test(arguments: ["", "2026-10-27", "2026-10-27T16:30:00.Z", "2026-10-27T16:30:00.12aZ", "nonsense"])
    func rejectsInvalid(input: String) {
        #expect(Wire.parse(input) == nil)
    }

    @Test func fastRoundTripsAtMillisecondPrecision() throws {
        let now = Date.nowMillis
        let fast = Fast(
            id: "7f1c5e3a-2b4d-4c6e-8f00-112233445566", startedAt: now, endedAt: nil,
            goalSeconds: 57600, notes: "", createdAt: now, updatedAt: now, deletedAt: nil,
            origin: "phone", serverSeq: nil)
        let data = try Wire.encoder().encode(Changes(fasts: [fast]))
        let decoded = try Wire.decoder().decode(Changes.self, from: data)
        #expect(decoded.fasts == [fast])

        // The server rejects unknown fields, so only its field names go out.
        let json = try #require(String(data: data, encoding: .utf8))
        #expect(json.contains("\"goal_seconds\":57600"))
        #expect(!json.contains("server_seq"))
    }
}
