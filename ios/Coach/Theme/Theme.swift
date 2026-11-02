import SwiftUI

/// Color tokens for the NEON//OS look.
enum Neon {
    static let background = Color(hex: 0x08050F)
    static let panel = Color(hex: 0x120D29)
    static let buttonInset = Color(hex: 0x140A1C)
    static let edge = Color(hex: 0x2A1F45)
    static let grid = Color(hex: 0x401A73, opacity: 0.35)
    static let text = Color(hex: 0xD9F2FF)
    static let muted = Color(hex: 0x737FA6)

    static let cyan = Color(hex: 0x00F2FF)
    static let magenta = Color(hex: 0xFF2EBF)
    static let amber = Color(hex: 0xFFB81A)
    static let lime = Color(hex: 0xA6FF00)
    static let violet = Color(hex: 0x9D7BFF)
    static let mint = Color(hex: 0x3DFFB4)
    static let heart = Color(hex: 0xFF4D6D)
}

/// Accent per domain, so a color always means the same thing.
extension Neon {
    static let fasting = amber
    static let cycling = cyan
    static let lifting = magenta
    static let running = lime
    static let mobility = violet
    static let breathing = mint
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity)
    }
}

/// Chakra Petch for titles and controls; Share Tech Mono for data.
enum NeonFont {
    enum Weight: String {
        case medium = "ChakraPetch-Medium"
        case semibold = "ChakraPetch-SemiBold"
        case bold = "ChakraPetch-Bold"
    }

    static func display(_ size: CGFloat, _ weight: Weight = .bold, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(weight.rawValue, size: size, relativeTo: style)
    }

    static func mono(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("ShareTechMono-Regular", size: size, relativeTo: style)
    }

    /// Large readouts that shouldn't grow with Dynamic Type.
    static func readout(_ size: CGFloat) -> Font {
        .custom("ShareTechMono-Regular", fixedSize: size)
    }
}

/// UserDefaults keys for display and alert preferences.
enum Prefs {
    static let scanlines = "display.scanlines"
    static let units = "display.units"
    static let defaultGoalHours = "fast.defaultGoalHours"
    static let alertGoal = "fast.alert.goal"
    static let alertHourBefore = "fast.alert.hourBefore"
    static let alertEvery4h = "fast.alert.every4h"

    static func registerDefaults() {
        UserDefaults.standard.register(defaults: [
            scanlines: true,
            units: Units.metric.rawValue,
            defaultGoalHours: 16,
            alertGoal: true,
            alertHourBefore: true,
            alertEvery4h: false,
        ])
    }
}

/// Stored in SI internally; this is display only.
enum Units: String, CaseIterable, Identifiable {
    case metric, imperial
    var id: String { rawValue }
}
