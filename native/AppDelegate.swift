import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let appURL: URL
    private let webDirectory: URL
    private var runtime: NativeApplicationRuntime?
    private var launchURLs: [URL] = []

    init(appURL: URL, webDirectory: URL) {
        self.appURL = appURL
        self.webDirectory = webDirectory
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let migration = UserDefaultsPreferenceMigration().migrate(
            bundleIdentifier: Bundle.main.bundleIdentifier ?? PreferenceMigrationPolicy.currentBundleIdentifier)
        if migration.shouldRegisterLaunchAtLogin {
            // Registration follows migration so SMAppService binds the user's old opt-in to this bundle identity.
            do { try StartupPreferences().configureLaunchAtLogin(true) }
            catch { /* StartupPreferences persists launchAtLoginError for the existing Settings status path. */ }
        }
        let runtime = NativeApplicationRuntime(appURL: appURL, webDirectory: webDirectory)
        self.runtime = runtime
        runtime.start(launchURLs: launchURLs)
        launchURLs.removeAll()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        runtime?.reopen()
        return true
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard let runtime else { launchURLs.append(contentsOf: urls); return }
        runtime.open(urls)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        runtime?.shouldTerminate() ?? .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) { runtime?.shutdown() }
}
