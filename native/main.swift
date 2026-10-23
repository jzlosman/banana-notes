import AppKit
import Foundation

let bundleID = Bundle.main.bundleIdentifier ?? "com.jzlosman.banana-notes"
let currentPID = ProcessInfo.processInfo.processIdentifier
if let existing = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
    .first(where: { $0.processIdentifier != currentPID && !$0.isTerminated }) {
    let showURL = URL(string: "banananotes://show")!
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    NSWorkspace.shared.open([showURL], withApplicationAt: Bundle.main.bundleURL,
                            configuration: configuration, completionHandler: nil)
    existing.activate(options: [.activateAllWindows])
    exit(EXIT_SUCCESS)
}

guard let resources = Bundle.main.resourceURL else {
    fputs("Banana Notes bundle is missing its Resources directory.\n", stderr)
    exit(EXIT_FAILURE)
}
let webDirectory = resources.appendingPathComponent("web", isDirectory: true)
let indexURL = webDirectory.appendingPathComponent("index.html")
guard FileManager.default.fileExists(atPath: indexURL.path) else {
    fputs("Banana Notes bundle is missing Resources/web/index.html. Build with scripts/build-app.sh after building web/dist.\n", stderr)
    exit(EXIT_FAILURE)
}

MainActor.assumeIsolated {
    let application = NSApplication.shared
    let delegate = AppDelegate(appURL: indexURL, webDirectory: webDirectory)
    application.delegate = delegate
    application.run()
}
