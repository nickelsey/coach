import SwiftUI

/// Stand-in for tabs whose milestone hasn't been built yet.
struct ModulePlaceholder: View {
    var title: String
    var accent: Color
    var milestone: String

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title)
                .font(NeonFont.display(22, relativeTo: .title2))
                .tracking(4)
                .foregroundStyle(accent)
                .neonGlow(accent, radius: 9)
                .accessibilityAddTraits(.isHeader)
            NeonPanel(accent: accent.opacity(0.6)) {
                PanelTitle(text: "MODULE // OFFLINE", color: accent)
                Text(milestone)
                    .font(NeonFont.mono(13))
                    .foregroundStyle(Neon.text)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 20)
    }
}
