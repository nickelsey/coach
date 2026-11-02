import SwiftUI

// MARK: - Glow

extension View {
    /// The two-layer neon glow used on accent text and lit segments.
    func neonGlow(_ color: Color, radius: CGFloat = 7) -> some View {
        shadow(color: color, radius: 2).shadow(color: color.opacity(0.8), radius: radius)
    }
}

// MARK: - Panel

/// A chamfered panel with a 1pt accent border.
struct NeonPanel<Content: View>: View {
    var accent: Color = Neon.edge
    var cut: CGFloat = 14
    var padding: CGFloat = 12
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ChamferShape(cut: cut).fill(Neon.panel))
            .overlay(ChamferShape(cut: cut).strokeBorder(accent, lineWidth: 1))
    }
}

/// "■ TITLE ————" header used at the top of panels.
struct PanelTitle: View {
    var text: String
    var color: Color = Neon.text

    var body: some View {
        HStack(spacing: 6) {
            Rectangle().fill(color).frame(width: 6, height: 6)
            Text(text)
                .font(NeonFont.display(11, relativeTo: .caption))
                .tracking(3)
                .foregroundStyle(color)
                .lineLimit(1)
            Rectangle().fill(color.opacity(0.4)).frame(height: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// "> LABEL ........ VALUE" diagnostic row.
struct DataRow: View {
    var label: String
    var value: String
    var color: Color = Neon.text

    var body: some View {
        HStack {
            Text("> \(label)")
            Spacer(minLength: 12)
            Text(value)
                .foregroundStyle(color)
                .neonGlow(color == Neon.text ? .clear : color, radius: 5)
        }
        .font(NeonFont.mono(13))
        .foregroundStyle(Neon.text)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Segmented bar

/// A row of square segments, lit up to `value` (in segments). A partly
/// filled segment shows dimmer.
struct SegmentedBar: View {
    var count: Int
    var value: Double
    var color: Color
    var height: CGFloat = 9
    var spacing: CGFloat = 2

    var body: some View {
        HStack(spacing: spacing) {
            ForEach(0..<max(count, 1), id: \.self) { i in
                let lit = value >= Double(i + 1)
                let partial = !lit && value > Double(i)
                Rectangle()
                    .fill(lit ? color : color.opacity(partial ? 0.55 : 0.14))
                    .frame(height: height)
                    .shadow(color: lit ? color : .clear, radius: 3)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Buttons

struct NeonButtonStyle: ButtonStyle {
    enum Kind {
        case filled, outline
    }

    var kind: Kind = .filled
    var color: Color = Neon.cyan
    var cut: CGFloat = 10
    var height: CGFloat = 46

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(NeonFont.display(13, relativeTo: .callout))
            .tracking(2)
            .textCase(.uppercase)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: max(height, 44))
            .foregroundStyle(kind == .filled ? Neon.background : color)
            .background {
                switch kind {
                case .filled: ChamferShape(cut: cut).fill(color)
                case .outline:
                    ChamferShape(cut: cut).fill(Neon.buttonInset)
                        .overlay(ChamferShape(cut: cut).strokeBorder(color, lineWidth: 1))
                }
            }
            .contentShape(ChamferShape(cut: cut))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

extension ButtonStyle where Self == NeonButtonStyle {
    static func neon(_ kind: NeonButtonStyle.Kind = .filled, _ color: Color = Neon.cyan, height: CGFloat = 46) -> NeonButtonStyle {
        NeonButtonStyle(kind: kind, color: color, height: height)
    }
}

/// Square checkbox-style toggle.
struct NeonToggleStyle: ToggleStyle {
    var color: Color = Neon.cyan

    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack {
                configuration.label
                    .font(NeonFont.mono(13))
                    .foregroundStyle(Neon.text)
                Spacer()
                Rectangle()
                    .strokeBorder(color, lineWidth: 1)
                    .background(Rectangle().fill(configuration.isOn ? color : .clear).padding(4))
                    .frame(width: 22, height: 22)
                    .shadow(color: configuration.isOn ? color.opacity(0.7) : .clear, radius: 4)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(configuration.isOn ? "On" : "Off")
    }
}

// MARK: - Backgrounds

/// The purple 24pt grid behind every screen.
struct GridBackground: View {
    var spacing: CGFloat = 24

    var body: some View {
        Canvas { ctx, size in
            var lines = Path()
            for x in stride(from: 0, through: size.width, by: spacing) {
                lines.addRect(CGRect(x: x, y: 0, width: 1, height: size.height))
            }
            for y in stride(from: 0, through: size.height, by: spacing) {
                lines.addRect(CGRect(x: 0, y: y, width: size.width, height: 1))
            }
            ctx.fill(lines, with: .color(Neon.grid))
        }
        .background(Neon.background)
        .accessibilityHidden(true)
    }
}

/// CRT scanlines over the whole UI. Optional (Settings > Display).
struct ScanlineOverlay: View {
    var body: some View {
        Canvas { ctx, size in
            var lines = Path()
            for y in stride(from: 0, through: size.height, by: 3) {
                lines.addRect(CGRect(x: 0, y: y, width: size.width, height: 1))
            }
            ctx.fill(lines, with: .color(.black.opacity(0.28)))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// A chamfered text field for settings.
struct NeonFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(NeonFont.mono(14))
            .foregroundStyle(Neon.text)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(ChamferShape(cut: 8).fill(Neon.background))
            .overlay(ChamferShape(cut: 8).strokeBorder(Neon.edge, lineWidth: 1))
    }
}
