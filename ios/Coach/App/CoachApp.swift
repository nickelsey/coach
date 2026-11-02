import SwiftUI

@main
struct CoachApp: App {
    @State private var model: AppModel

    init() {
        Prefs.registerDefaults()
        do {
            _model = State(initialValue: AppModel(database: try AppDatabase.onDisk()))
        } catch {
            fatalError("Couldn't open the database: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
    }
}
