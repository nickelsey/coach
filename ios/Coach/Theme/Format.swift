import Foundation

/// Text formats for the retro readouts: 24-hour, uppercase, zero-padded.
enum Format {
    /// "14:32" (hours can exceed 24).
    static func hoursMinutes(_ interval: TimeInterval) -> String {
        let total = max(0, Int(interval)) / 60
        return String(format: "%02d:%02d", total / 60, total % 60)
    }

    /// "14:32:07".
    static func hoursMinutesSeconds(_ interval: TimeInterval) -> String {
        let total = max(0, Int(interval))
        return String(format: "%02d:%02d:%02d", total / 3600, (total / 60) % 60, total % 60)
    }

    /// "T-01:28" before the goal, "+00:12" after it.
    static func countdown(_ remaining: TimeInterval) -> String {
        remaining > 0 ? "T-" + hoursMinutes(remaining) : "+" + hoursMinutes(-remaining)
    }

    /// "MON 16:30".
    static func dayTime(_ date: Date, calendar: Calendar = .current) -> String {
        let weekday = date.formatted(.dateTime.weekday(.abbreviated)).uppercased()
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%@ %02d:%02d", weekday, c.hour ?? 0, c.minute ?? 0)
    }

    /// "TUE 27.10".
    static func dayDate(_ date: Date, calendar: Calendar = .current) -> String {
        let weekday = date.formatted(.dateTime.weekday(.abbreviated)).uppercased()
        let c = calendar.dateComponents([.day, .month], from: date)
        return String(format: "%@ %02d.%02d", weekday, c.day ?? 0, c.month ?? 0)
    }

    /// "16H" or "16H 30M".
    static func goal(_ seconds: Int) -> String {
        let h = seconds / 3600, m = (seconds / 60) % 60
        return m == 0 ? "\(h)H" : "\(h)H \(m)M"
    }
}
