import AppKit

@MainActor
final class ViewerAppDelegate: NSObject, NSApplicationDelegate {
    private var runtime: ViewerApplicationRuntime?
    private var pendingURLs: [URL] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let resources = Bundle.main.resourceURL else {
            fail("Banana Viewer is missing its Resources directory.")
            return
        }
        let webDirectory = resources.appendingPathComponent("web", isDirectory: true)
        let required = ["viewer.html", "viewer.js", "viewer.css", "app.css", "theme-catalog.json", "note-font-catalog.json"]
        guard required.allSatisfy({ FileManager.default.fileExists(atPath: webDirectory.appendingPathComponent($0).path) }) else {
            fail("Banana Viewer web assets are incomplete. Build the web viewer assets before building the app.")
            return
        }
        do {
            let runtime = try ViewerApplicationRuntime(webDirectory: webDirectory)
            self.runtime = runtime
            runtime.start(launchURLs: commandLineFileURLs() + pendingURLs)
            pendingURLs.removeAll()
        } catch {
            fail("Banana Viewer could not load its bundled catalogs: \(error.localizedDescription)")
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard let runtime else { pendingURLs.append(contentsOf: urls); return }
        runtime.open(urls)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        runtime?.reopen()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationWillTerminate(_ notification: Notification) { runtime?.shutdown() }

    private func commandLineFileURLs() -> [URL] {
        CommandLine.arguments.dropFirst().filter { !$0.hasPrefix("-") }.map { argument in
            let expanded = (argument as NSString).expandingTildeInPath
            return URL(fileURLWithPath: expanded, relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath))
                .standardizedFileURL
        }
    }

    private func fail(_ message: String) {
        fputs("\(message)\n", stderr)
        NSApp.terminate(nil)
    }
}
