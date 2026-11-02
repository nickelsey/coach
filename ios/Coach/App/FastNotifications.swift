import Foundation
import UserNotifications

/// Local notifications for the running fast. Rescheduling is idempotent:
/// it clears every fast alert and schedules fresh ones from the current state,
/// so it's safe to call after any change, including ones that arrive by sync.
struct FastNotifications: Sendable {
    private static let prefix = "fast."

    func requestAuthorization() async {
        _ = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound, .badge])
    }

    func reschedule(for fast: Fast?, now: Date = .now) async {
        let center = UNUserNotificationCenter.current()
        let existing = await center.pendingNotificationRequests()
            .map(\.identifier)
            .filter { $0.hasPrefix(Self.prefix) }
        center.removePendingNotificationRequests(withIdentifiers: existing)

        guard let fast, fast.isActive else { return }
        for alert in Self.alerts(for: fast, defaults: .standard) where alert.date > now {
            let content = UNMutableNotificationContent()
            content.title = alert.title
            content.body = alert.body
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(
                timeInterval: alert.date.timeIntervalSince(now), repeats: false)
            try? await center.add(
                UNNotificationRequest(identifier: Self.prefix + alert.id, content: content, trigger: trigger))
        }
    }

    struct Alert: Equatable {
        var id: String
        var date: Date
        var title: String
        var body: String
    }

    /// The alerts a fast should have, given the user's preferences.
    static func alerts(for fast: Fast, defaults: UserDefaults) -> [Alert] {
        var out: [Alert] = []
        let goal = fast.goalDate
        let goalText = Format.goal(fast.goalSeconds)

        if defaults.bool(forKey: Prefs.alertGoal) {
            out.append(Alert(
                id: "goal", date: goal, title: "FAST // GOAL REACHED",
                body: "\(goalText) complete. End the fast whenever you're ready."))
        }
        if defaults.bool(forKey: Prefs.alertHourBefore), fast.goalSeconds > 3600 {
            out.append(Alert(
                id: "t-1h", date: goal.addingTimeInterval(-3600), title: "FAST // T-01:00",
                body: "One hour to your \(goalText) goal."))
        }
        if defaults.bool(forKey: Prefs.alertEvery4h) {
            for hours in stride(from: 4, to: fast.goalSeconds / 3600, by: 4) {
                out.append(Alert(
                    id: "h\(hours)", date: fast.startedAt.addingTimeInterval(TimeInterval(hours * 3600)),
                    title: "FAST // \(hours)H", body: "\(hours) hours in. Goal \(goalText)."))
            }
        }
        return out
    }
}
