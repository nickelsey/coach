import SwiftUI

/// The Fuel tab: fasting detail with the octagon timer, goal and alerts.
struct FastView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(Prefs.defaultGoalHours) private var defaultGoalHours = 16
    @AppStorage(Prefs.alertGoal) private var alertGoal = true
    @AppStorage(Prefs.alertHourBefore) private var alertHourBefore = true
    @AppStorage(Prefs.alertEvery4h) private var alertEvery4h = false
    @State private var confirmEnd = false

    private var goalHours: Int {
        model.activeFast.map { $0.goalSeconds / 3600 } ?? defaultGoalHours
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                HStack {
                    Text("FAST//\(goalHours):\(max(0, 24 - goalHours))")
                        .font(NeonFont.display(22, relativeTo: .title2))
                        .tracking(4)
                        .foregroundStyle(Neon.fasting)
                        .neonGlow(Neon.fasting, radius: 9)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    Text("PROTOCOL")
                        .font(NeonFont.mono(11, relativeTo: .caption))
                        .foregroundStyle(Neon.muted)
                }

                TimelineView(.periodic(from: .now, by: 1)) { context in
                    VStack(spacing: 16) {
                        timer(now: context.date)
                        hourBar(now: context.date)
                    }
                }

                details
                alerts
                mainButton
                if let error = model.lastError {
                    Text(error)
                        .font(NeonFont.mono(12))
                        .foregroundStyle(Neon.heart)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 20)
        }
        .scrollIndicators(.hidden)
        .confirmationDialog("End this fast?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End fast", role: .destructive) { model.endFast() }
        }
    }

    // MARK: Timer

    private func timer(now: Date) -> some View {
        let fast = model.activeFast
        let elapsed = fast?.elapsed(at: now) ?? 0
        let goal = TimeInterval(goalHours * 3600)
        let percent = fast == nil ? 0 : Int(min(elapsed / goal, 9.99) * 100)

        return VStack(spacing: 8) {
            Text(fast == nil ? "STANDBY" : "ELAPSED")
                .font(NeonFont.display(11, relativeTo: .caption))
                .tracking(4)
                .foregroundStyle(Neon.muted)
            Text(Format.hoursMinutesSeconds(elapsed))
                .font(NeonFont.readout(48))
                .foregroundStyle(fast == nil ? Neon.muted : Neon.fasting)
                .neonGlow(fast == nil ? .clear : Neon.fasting, radius: 12)
                .minimumScaleFactor(0.6)
            Text(fast == nil ? "GOAL \(Format.goal(Int(goal)))" : Format.countdown(goal - elapsed) + " TO GOAL")
                .font(NeonFont.mono(14))
                .foregroundStyle(Neon.text)
            Text("\(percent)% COMPLETE")
                .font(NeonFont.mono(11, relativeTo: .caption))
                .tracking(2)
                .foregroundStyle(Neon.fasting)
                .padding(.horizontal, 10)
                .padding(.vertical, 3)
                .overlay(Rectangle().strokeBorder(Neon.fasting.opacity(0.5), lineWidth: 1))
        }
        .frame(width: 270, height: 270)
        .background(OctagonShape().fill(Neon.panel))
        .overlay(OctagonShape().strokeBorder(Neon.fasting, lineWidth: 1.5))
        .shadow(color: Neon.fasting.opacity(0.35), radius: 12)
        .accessibilityElement(children: .combine)
    }

    private func hourBar(now: Date) -> some View {
        let elapsedHours = (model.activeFast?.elapsed(at: now) ?? 0) / 3600
        let segments = max(1, min(goalHours, 36))
        return VStack(spacing: 6) {
            SegmentedBar(
                count: segments, value: elapsedHours * Double(segments) / Double(goalHours),
                color: Neon.fasting, height: 16, spacing: 3)
            HStack {
                ForEach(Array(stride(from: 0, through: goalHours, by: max(1, goalHours / 4))), id: \.self) { h in
                    Text("\(h)H")
                        .foregroundStyle(h == goalHours ? Neon.fasting : Neon.muted)
                    if h < goalHours { Spacer() }
                }
            }
            .font(NeonFont.mono(11, relativeTo: .caption))
            .accessibilityHidden(true)
        }
    }

    // MARK: Details

    private var details: some View {
        NeonPanel {
            if let fast = model.activeFast {
                DataRow(label: "STARTED", value: Format.dayTime(fast.startedAt))
                DataRow(label: "GOAL", value: Format.goal(fast.goalSeconds), color: Neon.fasting)
                DataRow(label: "ENDS", value: Format.dayTime(fast.goalDate))
            } else {
                DataRow(label: "STATUS", value: "NO ACTIVE FAST")
                DataRow(label: "GOAL", value: "\(defaultGoalHours)H", color: Neon.fasting)
            }
            HStack(spacing: 10) {
                Button("-1H") { changeGoal(by: -1) }
                    .buttonStyle(.neon(.outline, Neon.fasting, height: 44))
                    .disabled(goalHours <= 1)
                Button("+1H") { changeGoal(by: 1) }
                    .buttonStyle(.neon(.outline, Neon.fasting, height: 44))
                    .disabled(goalHours >= 72)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Adjust goal")
        }
    }

    private func changeGoal(by delta: Int) {
        let hours = min(72, max(1, goalHours + delta))
        if model.activeFast != nil {
            model.setGoal(hours: hours)
        } else {
            defaultGoalHours = hours
        }
    }

    private var alerts: some View {
        NeonPanel(accent: Neon.fasting) {
            PanelTitle(text: "ALERTS", color: Neon.fasting)
            Toggle("> GOAL REACHED", isOn: $alertGoal)
            Toggle("> T-01:00", isOn: $alertHourBefore)
            Toggle("> EVERY 4H", isOn: $alertEvery4h)
        }
        .toggleStyle(NeonToggleStyle(color: Neon.fasting))
        .onChange(of: [alertGoal, alertHourBefore, alertEvery4h]) {
            model.alertPreferencesChanged()
        }
    }

    @ViewBuilder private var mainButton: some View {
        if model.activeFast != nil {
            Button("END FAST") { confirmEnd = true }
                .buttonStyle(.neon(.filled, Neon.fasting, height: 54))
        } else {
            Button("START FAST") { model.startFast(goalHours: defaultGoalHours) }
                .buttonStyle(.neon(.filled, Neon.fasting, height: 54))
        }
    }
}
