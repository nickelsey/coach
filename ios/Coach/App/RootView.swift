import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(Prefs.scanlines) private var scanlines = true

    var body: some View {
        @Bindable var model = model

        ZStack {
            GridBackground().ignoresSafeArea()
            switch model.tab {
            case .today: TodayView()
            case .train: ModulePlaceholder(title: "TRAIN//", accent: Neon.cycling, milestone: "Cycling recording and plans arrive in milestones 3–4.")
            case .fuel: FastView()
            case .body: ModulePlaceholder(title: "BODY//", accent: Neon.breathing, milestone: "Health import (sleep, HRV, resting HR) arrives in milestone 5.")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            NeonTabBar(selection: $model.tab)
        }
        .overlay {
            if scanlines { ScanlineOverlay().ignoresSafeArea() }
        }
        .preferredColorScheme(.dark)
        .tint(Neon.cyan)
        .task { await model.start() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.scheduleSync(after: .zero) }
        }
    }
}

/// Text-only tabs with a glowing top rule on the active one.
struct NeonTabBar: View {
    @Binding var selection: AppModel.Tab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppModel.Tab.allCases) { tab in
                let active = tab == selection
                Button {
                    selection = tab
                } label: {
                    Text(tab.title)
                        .font(NeonFont.display(12, relativeTo: .caption))
                        .tracking(2)
                        .foregroundStyle(active ? Neon.cyan : Neon.muted)
                        .neonGlow(active ? Neon.cyan : .clear, radius: 5)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .overlay(alignment: .top) {
                            Rectangle()
                                .fill(active ? Neon.cyan : .clear)
                                .frame(height: 2)
                                .shadow(color: active ? Neon.cyan : .clear, radius: 4)
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .background(Neon.background.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) {
            Rectangle().fill(Neon.cyan.opacity(0.4)).frame(height: 1)
        }
    }
}
