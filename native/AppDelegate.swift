import AppKit
import QuartzCore
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, ApplicationBridgeCapability {
    private let appURL: URL
    private let webDirectory: URL
    private var panel: NotePanel!
    private var webView: WKWebView!
    private var menuController: NativeMenuBarController!
    #if canImport(Sparkle)
    private var updateController: UpdateController?
    #endif
    private var updateAvailable = false
    private var store: (any LibraryRepository)!
    private var appearancePreferences: AppearancePreferences!
    private var windowStylePreferences: WindowStylePreferences!
    private var fontSizePreferences: FontSizePreferences!
    private var featurePreferences: FeaturePreferences!
    private var features: NativeFeatures?
    private var featureSetupError: String?
    private var pinned = false
    private let preferences: any PreferencesStore = UserDefaults.standard
    private var hotkeyAvailable = false
    private var hotkeyPreferences: HotkeyPreferences!
    private let hotkeyService = GlobalHotkeyService()
    private var hotkeyRegistrationError: String?
    private var commandsReady = false
    private var queuedCommands: [[String: Any]] = []
    private var launchURLs: [URL] = []
    private var flushInProgress = false
    private var flushGeneration = 0
    private var flushCompletions: [(Result<Void, Error>) -> Void] = []
    private var presentingNativeUI = false
    private var windowFocus = WindowFocusState()
    private var focusLossTimer: Timer?
    private var terminationRequested = false
    private var terminationReplySent = false

    init(appURL: URL, webDirectory: URL) {
        self.appURL = appURL
        self.webDirectory = webDirectory
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        store = LibraryStore()
        hotkeyPreferences = HotkeyPreferences(existingLibrary: FileManager.default.fileExists(atPath: store.libraryURL.path))
        appearancePreferences = AppearancePreferences(catalogURL: webDirectory.appendingPathComponent("theme-catalog.json"))
        windowStylePreferences = WindowStylePreferences()
        fontSizePreferences = FontSizePreferences()
        featurePreferences = FeaturePreferences()
        #if canImport(Sparkle)
        updateController = UpdateController()
        updateAvailable = updateController != nil
        #endif
        do { features = try NativeFeatures(directory: store.directory, catalogURL: webDirectory.appendingPathComponent("theme-catalog.json")) }
        catch { featureSetupError = error.localizedDescription }
        pinned = preferences.bool(forKey: "pinned")
        buildWindow()
        features?.windowProvider = { [weak self] in self?.panel }
        features?.ocrEnabledProvider = { [weak self] in self?.featurePreferences.ocrEnabled == true }
        hotkeyService.onHotkey = { [weak self] in self?.togglePanel() }
        registerHotkey()
        buildMenuBar()
        if let startupError = store.startupError { showError(startupError) }
        showPanel()
        webView.loadFileURL(appURL, allowingReadAccessTo: webDirectory)
        let pendingURLs = launchURLs
        launchURLs.removeAll()
        if pendingURLs.isEmpty, store.startupError == nil, features?.startup.consumeColdLaunchNewNoteDecision() == true { sendCommand(["action": "new"]) }
        pendingURLs.forEach(handleDeepLink)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        showPanel()
        return true
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        // LaunchServices can deliver a URL before didFinishLaunching constructs
        // the window. Preserve the intent until native and web startup are ready.
        guard panel != nil else { launchURLs.append(contentsOf: urls); return }
        urls.forEach(handleDeepLink)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminationRequested else { return .terminateLater }
        terminationRequested = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, !self.terminationReplySent else { return }
            NSLog("Banana Notes termination flush timed out after 3 seconds; terminating anyway.")
            self.replyToTermination()
        }
        flushThen { [weak self] result in
            guard let self, !self.terminationReplySent else { return }
            if case .failure(let error) = result {
                NSLog("Banana Notes termination flush failed; waiting for queued writes before terminating: %@", error.localizedDescription)
            }
            self.store.afterPendingWrites { [weak self] in
                DispatchQueue.main.async { self?.replyToTermination() }
            }
        }
        return .terminateLater
    }

    private func replyToTermination() {
        guard !terminationReplySent else { return }
        terminationReplySent = true
        NSApp.reply(toApplicationShouldTerminate: true)
    }

    func applicationWillTerminate(_ notification: Notification) {
        focusLossTimer?.invalidate()
        features?.cancelFontDownload()
        hotkeyService.unregister()
    }

    private func buildWindow() {
        let controller = NotePanelController(features: features, windowDelegate: self,
                                             navigationDelegate: self, uiDelegate: self,
                                             messageHandler: self, hideAction: { [weak self] in self?.hideAfterFlush() })
        panel = controller.panel
        webView = controller.webView
        applyNativeAppearance(appearancePreferences.selectedTheme)
        applyWindowStyle()
    }

    private func buildMenuBar() {
        menuController = NativeMenuBarController(target: self, hotkeyDisplay: hotkeyPreferences.chord.display,
                                                 hotkeyAvailable: hotkeyAvailable, updatesAvailable: updateAvailable)
    }

    @objc private func togglePanel() { panel.isVisible ? hideAfterFlush() : showPanel() }
    @objc private func newNote() { showPanel(); sendCommand(["action": "new"]) }
    @objc private func openExplorer() { showPanel(); sendCommand(["action": "explorer"]) }
    @objc private func openThemes() { showPanel(); sendCommand(["action": "themes"]) }
    @objc private func showHelp() { showPanel(); sendCommand(["action": "help"]) }
    @objc private func resetWindowEffects() {
        do {
            try windowStylePreferences.reset()
            applyWindowStyle()
            sendCommand(["action": "windowStyle", "style": windowStylePreferences.style.bridgeValue])
            showPanel()
        } catch { showError(error.localizedDescription) }
    }
    @objc private func biggerText() { sendCommand(["action": "fontIncrease"]) }
    @objc private func smallerText() { sendCommand(["action": "fontDecrease"]) }
    @objc private func actualTextSize() { sendCommand(["action": "fontReset"]) }
    @objc private func copyMarkdown() { sendCommand(["action": "copy", "format": "markdown"]) }
    @objc private func copyFormatted() { sendCommand(["action": "copy", "format": "formatted"]) }
    @objc private func copyHTML() { sendCommand(["action": "copy", "format": "html"]) }
    @objc private func copyPlainText() { sendCommand(["action": "copy", "format": "text"]) }
    @objc private func copyWholeNote() { sendCommand(["action": "copy", "format": "markdown", "whole": true]) }
    @objc private func openDataFolder() { NSWorkspace.shared.open(store.directory) }
    #if canImport(Sparkle)
    @objc private func checkForUpdates() { updateController?.checkForUpdates() }
    #endif
    @objc private func quit() { NSApp.terminate(nil) }
    @objc private func showAbout() {
        let info = Bundle.main.infoDictionary ?? [:]
        var options: [NSApplication.AboutPanelOptionKey: Any] = [.applicationName: "Banana Notes"]
        if let version = info["CFBundleShortVersionString"] as? String { options[.applicationVersion] = version }
        if let build = info["CFBundleVersion"] as? String { options[.version] = build }
        NSApp.orderFrontStandardAboutPanel(options: options)
    }
    @objc private func hideAfterFlushMenu() { hideAfterFlush() }

    private func showPanel() {
        guard let panel, let webView else { return }
        panel.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        webView.window?.makeFirstResponder(webView)
    }

    private func applyNativeAppearance(_ theme: CatalogTheme?) {
        guard let theme else {
            panel.appearance = nil
            (panel.contentView as? WindowContentView)?.surfaceColor = .windowBackgroundColor
            return
        }
        panel.appearance = NSAppearance(named: theme.appearance == .dark ? .darkAqua : .aqua)
        let value = UInt32(theme.colors.paper.dropFirst(), radix: 16)!
        (panel.contentView as? WindowContentView)?.surfaceColor = NSColor(
            calibratedRed: CGFloat((value >> 16) & 255) / 255,
            green: CGFloat((value >> 8) & 255) / 255,
            blue: CGFloat(value & 255) / 255, alpha: 1)
    }

    private func applyWindowStyle(animated: Bool = false) {
        guard let panel, let windowStylePreferences else { return }
        let opacity = windowStylePreferences.style.opacity(isFocused: windowFocus.isFocused)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = animated && panel.isVisible && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0.2 : 0
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().alphaValue = opacity
        }
        (panel.contentView as? WindowContentView)?.setGlassAmount(windowStylePreferences.style.glass)
    }

    private func publishFocus(animated: Bool = false) {
        applyWindowStyle(animated: animated)
        sendCommand(["action": "focus", "focused": windowFocus.isFocused])
    }

    @objc private func updateWindowFocus() {
        guard let panel else { return }
        focusLossTimer?.invalidate()
        focusLossTimer = nil
        let now = ProcessInfo.processInfo.systemUptime
        if windowFocus.update(isKeyWindow: panel.isKeyWindow, at: now) {
            publishFocus(animated: true)
            if !windowFocus.isFocused && !pinned && !presentingNativeUI && panel.isVisible && !flushInProgress {
                hideAfterFlush(onlyIfUnfocused: true)
            }
        }
        if let deadline = windowFocus.lossDeadline {
            let timer = Timer(timeInterval: max(0, deadline - now), target: self,
                              selector: #selector(updateWindowFocus), userInfo: nil, repeats: false)
            focusLossTimer = timer
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    private func hidePanel() { panel.orderOut(nil) }

    private func hideAfterFlush(onlyIfUnfocused: Bool = false) {
        flushThen { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                if onlyIfUnfocused && (self.windowFocus.isFocused || self.panel.isKeyWindow || self.pinned || self.presentingNativeUI) { return }
                self.hidePanel()
            case .failure(let error): self.showPanel(); self.showError("Banana Notes stayed open because the latest changes could not be saved. " + error.localizedDescription)
            }
        }
    }


    private func flushThen(_ completion: @escaping (Result<Void, Error>) -> Void) {
        // Before ready the editor cannot accept edits. Recovery/startup must still
        // be closable without forcing the user to terminate the process.
        guard commandsReady else { completion(.success(())); return }
        flushCompletions.append(completion)
        guard !flushInProgress else { return }
        flushInProgress = true
        flushGeneration += 1
        let generation = flushGeneration
        webView.callAsyncJavaScript(
            "if (typeof window.foldnoteCommand !== 'function') throw new Error('The editor flush command is unavailable'); await window.foldnoteCommand({action: 'flush'}); return true;",
            arguments: [:], in: nil, in: .page,
            completionHandler: { [weak self] (result: Result<Any, Error>) in
            Task { @MainActor in
                switch result {
                case .success: self?.finishFlush(.success(()), generation: generation)
                case .failure(let error): self?.finishFlush(.failure(error), generation: generation)
                }
            }
        })
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.finishFlush(.failure(StoreError(message: "Timed out waiting for the editor to finish saving.")), generation: generation)
        }
    }

    private func finishFlush(_ result: Result<Void, Error>, generation: Int) {
        guard flushInProgress, generation == flushGeneration else { return }
        flushInProgress = false
        let completions = flushCompletions
        flushCompletions.removeAll()
        completions.forEach { $0(result) }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { hideAfterFlush(); return false }
    func windowDidBecomeKey(_ notification: Notification) { updateWindowFocus() }
    func windowDidResignKey(_ notification: Notification) { updateWindowFocus() }

    // WKWebView must never navigate beyond the bundled app. Intentional web links
    // leave the app and open in the user's default browser.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.isFileURL, isInsideWebDirectory(url) { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated { openExternalLinkIfAllowed(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let source = navigationAction.sourceFrame.request.url, source.isFileURL,
           isInsideWebDirectory(source), let url = navigationAction.request.url {
            openExternalLinkIfAllowed(url)
        }
        return nil
    }

    private func openExternalLinkIfAllowed(_ url: URL) {
        guard let scheme = url.scheme?.lowercased() else { return }
        if ["http", "https"].contains(scheme), url.host != nil {
            NSWorkspace.shared.open(url)
        } else if scheme == "mailto" {
            NSWorkspace.shared.open(url)
        }
    }

    private func isInsideWebDirectory(_ url: URL) -> Bool {
        let root = webDirectory.resolvingSymlinksInPath().standardizedFileURL.path + "/"
        let path = url.resolvingSymlinksInPath().standardizedFileURL.path
        return path.hasPrefix(root) || path == String(root.dropLast())
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard BridgeSecurityPolicy.allows(isMainFrame: message.frameInfo.isMainFrame,
                                          frameURL: message.frameInfo.request.url,
                                          bundledIndexURL: appURL) else {
            replyHandler(nil, "Native requests are allowed only from the bundled Banana Notes editor.")
            return
        }
        do {
            let request = try BridgeCommandDecoder.decode(message.body)
            try BridgeRouter().route(request, application: self, features: features,
                                     presenting: { [weak self] value in self?.presentingNativeUI = value },
                                     reply: replyHandler)
        } catch { replyHandler(nil, error.localizedDescription) }
    }

    func handleApplicationBridge(_ request: DecodedBridgeRequest, reply: @escaping (Any?, String?) -> Void) throws {
        switch request.command {
        case .load:
            let library = try store.load()
            features?.scheduleAttachmentCollection(library: library)
            let display = hotkeyPreferences.chord.display
            let state: [String: Any] = ["library": library as Any? ?? NSNull(), "pinned": pinned,
                          "hotkey": display, "hotkeyAvailable": hotkeyAvailable,
                          "hotkeyStatus": hotkeyAvailable ? "\(display) toggles Banana Notes." : "\(display) could not be registered. Use the Banana Notes menu bar icon to open the app.",
                          "dataDirectory": store.directory.path, "themeID": appearancePreferences.selectedID,
                          "themeWarning": appearancePreferences.catalogError as Any? ?? NSNull(),
                          "focused": windowFocus.isFocused, "windowStyle": windowStylePreferences.style.bridgeValue,
                          "fontSize": fontSizePreferences.size, "ocrEnabled": featurePreferences.ocrEnabled,
                          "featureWarning": featureSetupError as Any? ?? NSNull()]
            reply(state.merging(features?.preferences ?? [:]) { _, new in new }, nil)
        case .save(let decodedLibrary):
            guard !terminationRequested else { throw StoreError(message: "Banana Notes is closing and cannot accept more saves.") }
            guard let library = decodedLibrary else { throw StoreError(message: "Missing library payload.") }
            store.saveAsync(library) { [weak self] result in
                DispatchQueue.main.async {
                    switch result {
                    case .success:
                        self?.features?.scheduleAttachmentCollection(library: library)
                        reply(["saved": true], nil)
                    case .failure(let error): reply(nil, error.localizedDescription)
                    }
                }
            }
        case .hide:
            hideAfterFlush(); reply(["ok": true], nil)
        case .dragRegion(let decodedRect):
            guard let rect = decodedRect?.foundationValue as? [String: Double],
                  let x = rect["x"], let y = rect["y"], let width = rect["width"], let height = rect["height"],
                  let content = panel?.contentView as? WindowContentView,
                  content.updateDragRegion(NSRect(x: CGFloat(x), y: CGFloat(y), width: CGFloat(width), height: CGFloat(height))) else {
                throw StoreError(message: "The toolbar drag area is invalid.")
            }
            reply(["ok": true], nil)
        case .pin(let decodedValue):
            guard let value = decodedValue?.foundationValue as? Bool else { throw StoreError(message: "Pinned must be a boolean.") }
            pinned = value
            preferences.set(pinned, forKey: "pinned")
            panel.hidesOnDeactivate = false
            reply(["pinned": pinned], nil)
        case .featurePreferences(let decodedValue):
            try featurePreferences.setOCR(decodedValue?.foundationValue)
            reply(["ocrEnabled": featurePreferences.ocrEnabled], nil)
        case .clipboard(let decodedValue):
            guard let content = decodedValue?.foundationValue as? [String: Any] else { throw StoreError(message: "Clipboard content is required.") }
            try ClipboardContent(content).write()
            reply(["copied": true], nil)
        case .fontSize(let decodedValue):
            try fontSizePreferences.save(decodedValue?.foundationValue)
            reply(["fontSize": fontSizePreferences.size], nil)
        case .windowStyle(let decodedValue):
            guard let fields = decodedValue?.foundationValue as? [String: Any] else { throw StoreError(message: "Window effect values are required.") }
            try windowStylePreferences.save(fields)
            applyWindowStyle()
            reply(["windowStyle": windowStylePreferences.style.bridgeValue], nil)
        case .theme(let decodedValue):
            guard let id = decodedValue?.foundationValue as? String else { throw StoreError(message: "A theme ID is required.") }
            let theme = try appearancePreferences.select(id)
            applyNativeAppearance(theme)
            reply(["themeID": appearancePreferences.selectedID], nil)
        case .export(let decodedValue):
            guard let notes = decodedValue?.foundationValue as? [[String: Any]] else { throw StoreError(message: "Export notes must be an array.") }
            try export(notes: notes) { result in
                switch result {
                case .success(let exported): reply(["exported": exported], nil)
                case .failure(let error): reply(nil, error.localizedDescription)
                }
            }
        case .openData:
            NSWorkspace.shared.open(store.directory); reply(["ok": true], nil)
        case .ready:
            commandsReady = true
            let pending = queuedCommands
            queuedCommands.removeAll()
            pending.forEach(evaluateCommand)
            updateWindowFocus()
            publishFocus()
            reply(["ok": true], nil)
        case .quit:
            reply(["ok": true], nil)
            DispatchQueue.main.async { NSApp.terminate(nil) }
        case .libraryRecovery:
            let status = store.recoveryStatus()
            var value: [String: Any] = ["startupError": status.startupError as Any? ?? NSNull(), "backupAvailable": status.backupAvailable]
            if let updatedAt = status.backupUpdatedAt { value["backupUpdatedAt"] = updatedAt }
            if let noteCount = status.backupNoteCount { value["backupNoteCount"] = noteCount }
            reply(value, nil)
        case .restoreBackup:
            try store.restoreBackup()
            features?.scheduleAttachmentCollection(library: try store.load())
            reply(["restored": true], nil)
        case .hotkeyPreferences(let decodedShortcut):
            if let shortcut = decodedShortcut { reply(try setHotkey(shortcut.foundationValue), nil) }
            else { reply(hotkeyReply(), nil) }
        case .feature(_, _):
            throw BridgeDecodeError.invalidJSON
        }
    }

    private func export(notes: [[String: Any]], completion: @escaping (Result<Bool, Error>) -> Void) throws {
        struct ExportItem { let filename: String; let markdown: String }
        let items: [ExportItem] = try notes.map { note in
            guard let id = note["id"] as? String, let markdown = note["markdown"] as? String else {
                throw StoreError(message: "Each exported note requires an id and markdown.")
            }
            let title = (note["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let base = (title?.isEmpty == false ? title! : id).foldnoteFilename
            return ExportItem(filename: base.isEmpty ? "note" : base, markdown: markdown)
        }
        let panel = NSOpenPanel()
        panel.title = "Export Notes"
        panel.prompt = "Export"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        presentingNativeUI = true
        panel.begin { [weak self] response in
            self?.presentingNativeUI = false
            guard response == .OK, let folder = panel.url else { completion(.success(false)); return }
            do {
                var used = Set<String>()
                for item in items {
                    var filename = item.filename + ".md"
                    var suffix = 2
                    while used.contains(filename.lowercased()) || FileManager.default.fileExists(atPath: folder.appendingPathComponent(filename).path) {
                        filename = "\(item.filename) (\(suffix)).md"; suffix += 1
                    }
                    used.insert(filename.lowercased())
                    try Data(item.markdown.utf8).write(to: folder.appendingPathComponent(filename), options: .atomic)
                }
                completion(.success(true))
            } catch { completion(.failure(error)) }
        }
    }

    private func sendCommand(_ command: [String: Any]) {
        guard commandsReady else { queuedCommands.append(command); return }
        evaluateCommand(command)
    }

    private func evaluateCommand(_ command: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(command),
              let data = try? JSONSerialization.data(withJSONObject: command),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.foldnoteCommand && window.foldnoteCommand(\(json));", completionHandler: nil)
    }

    private func handleDeepLink(_ url: URL) {
        guard let command = AppDeepLink.command(for: url) else { return }
        showPanel()
        sendCommand(command)
    }

    private func registerHotkey() {
        let result = hotkeyService.register(hotkeyPreferences.chord)
        hotkeyAvailable = result.registered
        hotkeyRegistrationError = result.error
        refreshHotkeyHint()
    }

    private func refreshHotkeyHint() {
        let display = hotkeyPreferences.chord.display
        menuController?.updateHotkey(display: display, registered: hotkeyAvailable)
    }

    private func hotkeyReply(chord: HotkeyChord? = nil, error: String? = nil) -> [String: Any] {
        let selected = chord ?? hotkeyPreferences.chord
        var value: [String: Any] = ["keyCode": selected.keyCode, "modifiers": selected.modifiers,
                                    "display": selected.display, "registered": hotkeyAvailable]
        if let error = error ?? hotkeyRegistrationError { value["error"] = error }
        return value
    }

    private func setHotkey(_ value: Any?) throws -> [String: Any] {
        let requested = try HotkeyChord.decode(value)
        let registration = hotkeyService.register(requested)
        hotkeyAvailable = registration.registered
        hotkeyRegistrationError = registration.error
        if registration.registered { hotkeyPreferences.select(requested) }
        refreshHotkeyHint()
        return hotkeyReply(error: registration.error)
    }

    private func showError(_ message: String) {
        presentingNativeUI = true
        defer { presentingNativeUI = false }
        let alert = NSAlert()
        alert.messageText = "Unable to Complete the Operation"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Open Data Folder")
        alert.addButton(withTitle: "OK")
        if alert.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(store.directory) }
    }
}

private extension String {
    var foldnoteFilename: String {
        let invalid = CharacterSet(charactersIn: "/\\:?%*|\"<>\n\r\0")
        let pieces = components(separatedBy: invalid).filter { !$0.isEmpty }
        return pieces.joined(separator: "-").trimmingCharacters(in: .whitespacesAndNewlines).prefix(120).description
    }
}
