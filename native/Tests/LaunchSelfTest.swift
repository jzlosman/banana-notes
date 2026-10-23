import AppKit
@testable import BananaNotesCore

@main
struct LaunchSelfTest {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let directory = FileManager.default.temporaryDirectory
        let delegate = AppDelegate(appURL: directory.appendingPathComponent("not-loaded.html"), webDirectory: directory)
        // Neither callback may dereference native views before didFinishLaunching.
        delegate.application(app, open: [URL(string: "banananotes://themes")!, URL(string: "foldnote://tag/work")!])
        precondition(delegate.applicationShouldHandleReopen(app, hasVisibleWindows: false))
        print("Native startup checks passed (early URL delivery and reopen before window creation)")
    }
}
