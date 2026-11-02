import SwiftUI

struct TodayView: View {
    @Environment(AppModel.self) private var model
    @State private var showSettings = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                header
                FastCard()
                vitals
                nextWorkout
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 20)
        }
        .scrollIndicators(.hidden)
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    private var header: some View {
        HStack(alignment: .center) {
            Text("COACH//OS")
                .font(NeonFont.display(22, relativeTo: .title2))
                .tracking(4)
                .foregroundStyle(Neon.magenta)
                .neonGlow(Neon.magenta, radius: 9)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(Format.dayDate(.now))
                    .foregroundStyle(Neon.muted)
                SyncBadge(status: model.syncStatus)
            }
            .font(NeonFont.mono(11, relativeTo: .caption))
            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Neon.text)
                    .frame(width: 44, height: 44)
                    .background(ChamferShape(cut: 9).fill(Neon.panel))
                    .overlay(ChamferShape(cut: 9).strokeBorder(Neon.edge, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Settings")
        }
    }

    // Placeholders until HealthKit import (milestone 5) and plans (milestone 4).
    private var vitals: some View {
        NeonPanel {
            PanelTitle(text: "VITALS")
            DataRow(label: "RESTING HR", value: "--", color: Neon.heart)
            DataRow(label: "HRV", value: "--", color: Neon.breathing)
            DataRow(label: "SLEEP", value: "--", color: Neon.mobility)
            Text("HEALTH LINK // NOT YET CONNECTED")
                .font(NeonFont.mono(11, relativeTo: .caption))
                .foregroundStyle(Neon.muted)
        }
    }

    private var nextWorkout: some View {
        NeonPanel(accent: Neon.cycling.opacity(0.5)) {
            PanelTitle(text: "NEXT // QUEUE", color: Neon.cycling)
            Text("NO WORKOUT SCHEDULED")
                .font(NeonFont.display(18, relativeTo: .headline))
                .tracking(1)
                .foregroundStyle(Neon.text)
            Text("Plans pushed from the desktop will appear here.")
                .font(NeonFont.mono(12, relativeTo: .footnote))
                .foregroundStyle(Neon.muted)
        }
    }
}

struct SyncBadge: View {
    var status: AppModel.SyncStatus

    var body: some View {
        let (text, color): (String, Color) = switch status {
        case .notConfigured: ("NO LINK CFG", Neon.amber)
        case .idle: ("LINK IDLE", Neon.muted)
        case .syncing: ("SYNCING", Neon.cyan)
        case .ok: ("LINK OK", Neon.mint)
        case .failed: ("OFFLINE", Neon.heart)
        }
        HStack(spacing: 5) {
            Rectangle().fill(color).frame(width: 6, height: 6).neonGlow(color, radius: 3)
            Text(text).foregroundStyle(color)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Sync status: \(text.lowercased())")
    }
}

/// The fasting summary on Today. Tapping DETAIL jumps to the Fuel tab.
struct FastCard: View {
    @Environment(AppModel.self) private var model
    @AppStorage(Prefs.defaultGoalHours) private var defaultGoalHours = 16

    var body: some View {
        NeonPanel(accent: Neon.fasting) {
            if let fast = model.activeFast {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    active(fast, now: context.date)
                }
            } else {
                idle
            }
        }
    }

    private func active(_ fast: Fast, now: Date) -> some View {
        let elapsed = fast.elapsed(at: now)
        let goal = TimeInterval(fast.goalSeconds)
        let hours = max(1, min(fast.goalSeconds / 3600, 24))
        return VStack(alignment: .leading, spacing: 8) {
            PanelTitle(text: "FAST // ACTIVE", color: Neon.fasting)
            HStack(alignment: .firstTextBaseline) {
                Text(Format.hoursMinutes(elapsed))
                    .font(NeonFont.readout(44))
                    .foregroundStyle(Neon.fasting)
                    .neonGlow(Neon.fasting, radius: 10)
                Text("/ " + Format.hoursMinutes(goal))
                    .font(NeonFont.mono(16))
                    .foregroundStyle(Neon.muted)
                Spacer()
                Text(Format.countdown(goal - elapsed))
                    .font(NeonFont.mono(12))
                    .foregroundStyle(Neon.text)
            }
            .accessibilityElement(children: .combine)
            SegmentedBar(count: hours, value: elapsed / goal * Double(hours), color: Neon.fasting)
            HStack(spacing: 10) {
                Button("DETAIL") { model.tab = .fuel }
                    .buttonStyle(.neon(.outline, Neon.fasting, height: 44))
                Button("END FAST") { model.endFast() }
                    .buttonStyle(.neon(.filled, Neon.fasting, height: 44))
            }
        }
    }

    private var idle: some View {
        VStack(alignment: .leading, spacing: 8) {
            PanelTitle(text: "FAST // IDLE", color: Neon.fasting)
            HStack(alignment: .firstTextBaseline) {
                Text("--:--")
                    .font(NeonFont.readout(44))
                    .foregroundStyle(Neon.muted)
                Spacer()
                Text("GOAL \(defaultGoalHours)H")
                    .font(NeonFont.mono(12))
                    .foregroundStyle(Neon.text)
            }
            Button("START FAST") { model.startFast(goalHours: defaultGoalHours) }
                .buttonStyle(.neon(.filled, Neon.fasting))
        }
    }
}
