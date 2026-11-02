import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @AppStorage(Prefs.scanlines) private var scanlines = true
    @AppStorage(Prefs.units) private var units = Units.metric.rawValue

    @State private var url = ""
    @State private var token = ""
    @State private var checkResult: String?
    @State private var checking = false

    var body: some View {
        ZStack {
            GridBackground().ignoresSafeArea()
            ScrollView {
                VStack(spacing: 14) {
                    HStack {
                        Text("SYS//CONFIG")
                            .font(NeonFont.display(22, relativeTo: .title2))
                            .tracking(4)
                            .foregroundStyle(Neon.cyan)
                            .neonGlow(Neon.cyan, radius: 9)
                            .accessibilityAddTraits(.isHeader)
                        Spacer()
                        Button("DONE") { save(); dismiss() }
                            .buttonStyle(.neon(.outline, Neon.cyan, height: 44))
                            .frame(width: 100)
                    }
                    server
                    display
                    about
                }
                .padding(16)
            }
            .scrollIndicators(.hidden)
            if scanlines { ScanlineOverlay().ignoresSafeArea() }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            url = model.server.url
            token = model.server.token
        }
        .onDisappear(perform: save)
    }

    private var server: some View {
        NeonPanel(accent: Neon.cyan) {
            PanelTitle(text: "UPLINK", color: Neon.cyan)
            Text("> SERVER ADDRESS")
                .font(NeonFont.mono(12, relativeTo: .footnote))
                .foregroundStyle(Neon.muted)
            TextField("https://coach.your-tailnet.ts.net", text: $url)
                .textFieldStyle(NeonFieldStyle())
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.URL)
            Text("> API TOKEN")
                .font(NeonFont.mono(12, relativeTo: .footnote))
                .foregroundStyle(Neon.muted)
            SecureField("COACH_API_TOKEN", text: $token)
                .textFieldStyle(NeonFieldStyle())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            HStack(spacing: 10) {
                Button(checking ? "TESTING…" : "TEST LINK") {
                    save()
                    checking = true
                    Task {
                        checkResult = await model.testConnection()
                        checking = false
                    }
                }
                .buttonStyle(.neon(.outline, Neon.cyan, height: 44))
                .disabled(checking)
                Button("SYNC NOW") {
                    save()
                    Task { await model.syncNow() }
                }
                .buttonStyle(.neon(.filled, Neon.cyan, height: 44))
            }
            if let checkResult {
                Text(checkResult)
                    .font(NeonFont.mono(12, relativeTo: .footnote))
                    .foregroundStyle(checkResult == "LINK OK" ? Neon.mint : Neon.heart)
            }
            HStack {
                SyncBadge(status: model.syncStatus)
                Spacer()
                if case .ok(let date) = model.syncStatus {
                    Text("LAST " + Format.dayTime(date))
                        .foregroundStyle(Neon.muted)
                }
            }
            .font(NeonFont.mono(11, relativeTo: .caption))
            if case .failed(let message) = model.syncStatus {
                Text(message)
                    .font(NeonFont.mono(12, relativeTo: .footnote))
                    .foregroundStyle(Neon.heart)
            }
        }
    }

    private var display: some View {
        NeonPanel {
            PanelTitle(text: "DISPLAY")
            Toggle("> SCANLINES", isOn: $scanlines)
                .toggleStyle(NeonToggleStyle(color: Neon.magenta))
            Text("> UNITS")
                .font(NeonFont.mono(13))
                .foregroundStyle(Neon.text)
            HStack(spacing: 10) {
                ForEach(Units.allCases) { option in
                    Button(option.rawValue) { units = option.rawValue }
                        .buttonStyle(.neon(units == option.rawValue ? .filled : .outline, Neon.magenta, height: 44))
                        .accessibilityAddTraits(units == option.rawValue ? .isSelected : [])
                }
            }
        }
    }

    private var about: some View {
        NeonPanel {
            PanelTitle(text: "SYSTEM")
            DataRow(
                label: "VERSION",
                value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")
            DataRow(label: "STORAGE", value: "LOCAL-FIRST")
        }
    }

    private func save() {
        let config = ServerConfig(url: url, token: token)
        if config != model.server { model.updateServer(config) }
    }
}
