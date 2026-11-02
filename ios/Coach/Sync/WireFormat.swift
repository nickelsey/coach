import Foundation

/// Request and response bodies for the server's /v1/sync endpoints.
struct Changes: Codable, Equatable, Sendable {
    var fasts: [Fast] = []

    var isEmpty: Bool { fasts.isEmpty }
}

struct PushResult: Decodable, Sendable {
    var applied: [String]
    var stale: [String]
}

struct PullResult: Decodable, Sendable {
    var changes: Changes
    var cursor: Int64
    var hasMore: Bool

    enum CodingKeys: String, CodingKey {
        case changes, cursor
        case hasMore = "has_more"
    }
}

/// JSON coding matching the Go server: RFC 3339 timestamps. Go emits
/// anywhere from 0 to 9 fractional digits, so decoding parses the fraction by
/// hand; encoding always writes milliseconds.
enum Wire {
    static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(format(date))
        }
        return e
    }

    static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let s = try c.decode(String.self)
            guard let date = parse(s) else {
                throw DecodingError.dataCorruptedError(
                    in: c, debugDescription: "Invalid RFC 3339 timestamp: \(s)")
            }
            return date
        }
        return d
    }

    /// "2026-10-27T16:30:00.123Z", built from integer milliseconds so the
    /// fraction is exact.
    static func format(_ date: Date) -> String {
        let ms = date.epochMillis
        let seconds = ms >= 0 ? ms / 1000 : (ms - 999) / 1000
        let base = Date(timeIntervalSince1970: Double(seconds)).formatted(.iso8601) // "...:00Z"
        return String(base.dropLast()) + String(format: ".%03dZ", ms - seconds * 1000)
    }

    static func parse(_ s: String) -> Date? {
        // Split "2026-10-27T16:30:00.123456Z" into base, fraction and zone.
        guard let tIndex = s.firstIndex(of: "T"),
            let zoneStart = s[tIndex...].lastIndex(where: { $0 == "Z" || $0 == "+" || $0 == "-" })
        else { return nil }
        var head = String(s[..<zoneStart])
        let zone = String(s[zoneStart...])
        var digits = ""
        if let dot = head.firstIndex(of: ".") {
            digits = String(head[head.index(after: dot)...])
            guard !digits.isEmpty, digits.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
            head = String(head[..<dot])
        }
        guard let base = try? Date(head + zone, strategy: .iso8601) else { return nil }
        if digits.count <= 3 {
            // Whole milliseconds: build from integers so the result is exactly
            // what Date(epochMillis:) produces locally.
            let ms = Int64(digits.padding(toLength: 3, withPad: "0", startingAt: 0)) ?? 0
            return Date(epochMillis: base.epochMillis + ms)
        }
        return base.addingTimeInterval(Double("0." + digits) ?? 0)
    }
}
