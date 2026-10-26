import AppKit
import WebKit

@MainActor
final class NativeApplicationRuntime {
    private let appURL: URL
    private let webDirectory: URL
    private let preferences: any PreferencesStore
    private var store: LibraryStore!
    private var appearance: AppearancePreferences!
    private var stylePreferences: WindowStylePreferences!
    private var fontSize: FontSizePreferences!
    private var featurePreferences: FeaturePreferences!
    private var features: NativeFeatures?
    private var featureSetupError: String?
    private var window: WindowCoordinator!
    private var panelController: NotePanelController!
    private var navigationAdapter: WebNavigationAdapter!
    private var messageAdapter: NativeBridgeMessageAdapter!
    private var transport: WebKitCommandTransport!
    private var channel: WebCommandChannel!
    private var fontHandler: FontBridgeHandler?
    private var hotkey: HotkeyCoordinator!
    private var menuController: NativeMenuBarController?
    private var menuActions: MenuActionCoordinator?
    private var bugReportController: BugReportController?
    private var crashReportPrompt: CrashReportPromptAdapter?
    private var termination: ApplicationTerminationCoordinator?
    #if canImport(Sparkle)
    private var updater: UpdateController?
    #endif

    init(appURL: URL, webDirectory: URL, preferences: any PreferencesStore = UserDefaults.standard) {
        self.appURL = appURL
        self.webDirectory = webDirectory
        self.preferences = preferences
    }

    func start(launchURLs: [URL] = []) {
        NSApp.setActivationPolicy(.accessory)
        store = LibraryStore()
        appearance = AppearancePreferences(catalogURL: webDirectory.appendingPathComponent("theme-catalog.json"), defaults: preferences)
        stylePreferences = WindowStylePreferences(defaults: preferences)
        fontSize = FontSizePreferences(defaults: preferences)
        featurePreferences = FeaturePreferences(defaults: preferences)
        hotkey = HotkeyCoordinator(defaults: preferences,
            existingLibrary: FileManager.default.fileExists(atPath: store.libraryURL.path))
        #if canImport(Sparkle)
        updater = UpdateController()
        #endif
        do {
            features = try NativeFeatures(directory: store.directory,
                catalogURL: webDirectory.appendingPathComponent("theme-catalog.json"), defaults: preferences)
        } catch { featureSetupError = error.localizedDescription }
        composeWindowAndBridge()
        hotkey.onHotkey = { [weak self] in self?.window.toggle() }
        hotkey.onChange = { [weak self] display, registered in
            self?.menuController?.updateHotkey(display: display, registered: registered)
        }
        hotkey.registerInitial()
        composeMenu()
        termination = ApplicationTerminationCoordinator(store: store, channel: channel)
        if let startupError = store.startupError { showError(startupError) }
        window.show()
        panelController.webView.loadFileURL(appURL, allowingReadAccessTo: webDirectory)
        if launchURLs.isEmpty, store.startupError == nil, features?.startup.consumeColdLaunchNewNoteDecision() == true {
            channel.send(.new)
        }
        launchURLs.forEach(handleDeepLink)
        crashReportPrompt?.promptIfNeeded(bundleIdentifier: Bundle.main.bundleIdentifier)
    }

    func reopen() { window?.show() }

    func open(_ urls: [URL]) { urls.forEach(handleDeepLink) }

    func shouldTerminate() -> NSApplication.TerminateReply { termination?.request() ?? .terminateNow }

    func shutdown() {
        window?.shutdown()
        hotkey?.unregister()
        fontHandler?.shutdown()
    }

    private func composeWindowAndBridge() {
        window = WindowCoordinator(stylePreferences: stylePreferences, preferences: preferences)
        window.onError = { [weak self] in self?.showError($0) }
        navigationAdapter = WebNavigationAdapter(bundledRoot: webDirectory)
        messageAdapter = NativeBridgeMessageAdapter(bundledIndexURL: appURL)
        panelController = NotePanelController(features: features, windowDelegate: window,
            navigationDelegate: navigationAdapter, uiDelegate: navigationAdapter, messageHandler: messageAdapter,
            hideAction: { [weak window] in window?.hideAfterFlush() })
        window.attach(panel: panelController.panel, webView: panelController.webView)
        window.apply(theme: appearance.selectedTheme)
        let webTransport = WebKitCommandTransport(webView: panelController.webView)
        transport = webTransport
        channel = WebCommandChannel(send: { [weak webTransport] in webTransport?.send($0) },
                                    flush: { [weak webTransport] in webTransport?.flush($0) })
        window.attach(channel: channel)
        messageAdapter.router = BridgeRouter(handlers: makeBridgeHandlers())
    }

    private func makeBridgeHandlers() -> [any BridgeHandler] {
        var handlers: [any BridgeHandler] = [
            ApplicationBridgeHandler(store: store, features: features, appearance: appearance,
                window: window, fontSize: fontSize, featurePreferences: featurePreferences,
                hotkey: hotkey, featureSetupError: featureSetupError),
            LibraryBridgeHandler(store: store, features: features, isClosing: { [weak self] in self?.termination?.isClosing ?? false }),
            WindowBridgeHandler(window: window, channel: channel, windowStyle: stylePreferences, fontSize: fontSize),
            PreferencesBridgeHandler(appearance: appearance, features: features, window: window,
                featurePreferences: featurePreferences, hotkey: hotkey, defaults: preferences),
            ClipboardBridgeHandler(),
            MarkdownExportBridgeHandler(window: window)
        ]
        if let features {
            let fonts = FontBridgeHandler(fonts: features.noteFonts)
            fontHandler = fonts
            handlers += [AttachmentBridgeHandler(attachments: features.attachments, window: window, ocrEnabled: featurePreferences),
                         fonts, PNGExportBridgeHandler(exporter: features.png, window: window),
                         SemanticBridgeHandler(search: features.semantic)]
        } else {
            handlers += [UnavailableBridgeHandler(capability: .attachments), UnavailableBridgeHandler(capability: .fonts),
                         UnavailableBridgeHandler(capability: .pngExport), UnavailableBridgeHandler(capability: .semantic)]
        }
        return handlers
    }

    private func composeMenu() {
        #if canImport(Sparkle)
        let updatesAvailable = updater != nil
        #else
        let updatesAvailable = false
        #endif
        let appearance = self.appearance!
        let reportController = BugReportController(diagnostics: { [appearance] in
            let themeName = appearance.selectedTheme?.name
                ?? (appearance.selectedID == AppearancePreferences.systemID ? "Follow macOS" : appearance.selectedID)
            return BugReportDiagnosticsAdapter.current(themeName: themeName)
        })
        bugReportController = reportController
        crashReportPrompt = CrashReportPromptAdapter(
            preferences: preferences, reports: CrashReportDirectoryAdapter(), bugReports: reportController)
        let actions = MenuActionCoordinator(window: window, channel: channel, windowStyle: stylePreferences,
            dataDirectory: store.directory, checkForUpdates: { [weak self] in
                #if canImport(Sparkle)
                self?.updater?.checkForUpdates()
                #endif
            }, reportBug: { [weak reportController] in reportController?.reportBug() })
        menuActions = actions
        let menu = NativeMenuBarController(hotkeyDisplay: hotkey.chord.display,
            hotkeyAvailable: hotkey.available, updatesAvailable: updatesAvailable, isPinned: window.isPinned,
            onAction: { [weak actions] in actions?.handle($0) })
        menuController = menu
        window.onPinnedChange = { [weak menu] isPinned in menu?.updatePinned(isPinned) }
    }

    private func handleDeepLink(_ url: URL) {
        guard let command = AppDeepLink.command(for: url) else { return }
        window.show()
        channel.send(command)
    }

    private func showError(_ message: String) {
        window?.setPresentingNativeUI(true)
        defer { window?.setPresentingNativeUI(false) }
        let alert = NSAlert()
        alert.messageText = "Unable to Complete the Operation"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Open Data Folder")
        alert.addButton(withTitle: "OK")
        if alert.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(store.directory) }
    }
}
