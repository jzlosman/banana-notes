import AppKit
import Carbon
import QuartzCore
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    private let appURL: URL
    private let webDirectory: URL
    private var panel: FoldnotePanel!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem!
    private var store: LibraryStore!
    private var appearancePreferences: AppearancePreferences!
    private var windowStylePreferences: WindowStylePreferences!
    private var fontSizePreferences: FontSizePreferences!
    private var featurePreferences: FeaturePreferences!
    private var features: NativeFeatures?
    private var featureSetupError: String?
    private var pinned = false
    private var hotkeyAvailable = false
    private var commandsReady = false
    private var queuedCommands: [[String: Any]] = []
    private var launchURLs: [URL] = []
    private var flushInProgress = false
    private var flushGeneration = 0
    private var flushCompletions: [(Result<Void, Error>) -> Void] = []
    private var presentingNativeUI = false
    private var windowFocus = WindowFocusState()
    private var focusLossTimer: Timer?
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?

    init(appURL: URL, webDirectory: URL) {
        self.appURL = appURL
        self.webDirectory = webDirectory
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        store = LibraryStore()
        appearancePreferences = AppearancePreferences(catalogURL: webDirectory.appendingPathComponent("theme-catalog.json"))
        windowStylePreferences = WindowStylePreferences()
        fontSizePreferences = FontSizePreferences()
        featurePreferences = FeaturePreferences()
        do { features = try NativeFeatures(directory: store.directory, catalogURL: webDirectory.appendingPathComponent("theme-catalog.json")) }
        catch { featureSetupError = error.localizedDescription }
        pinned = UserDefaults.standard.bool(forKey: "pinned")
        buildWindow()
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

    func applicationWillTerminate(_ notification: Notification) {
        focusLossTimer?.invalidate()
        features?.cancelFontDownload()
        if let hotkey = hotKeyRef { UnregisterEventHotKey(hotkey) }
        if let handler = eventHandler { RemoveEventHandler(handler) }
    }

    private func buildWindow() {
        let configuration = WKWebViewConfiguration()
        features?.configureMedia(configuration)
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "native")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if DEBUG
        let environment = ProcessInfo.processInfo.environment
        webView.isInspectable = (environment["BANANA_NOTES_DEBUG"] ?? environment["FOLDNOTE_DEBUG"]) == "1"
        #else
        webView.isInspectable = false
        #endif
        webView.setValue(false, forKey: "drawsBackground")

        panel = FoldnotePanel(contentRect: NSRect(x: 0, y: 0, width: 540, height: 650),
                              styleMask: [.borderless, .resizable],
                              backing: .buffered, defer: false)
        panel.title = "Banana Notes" // Accessibility/window identity, not visible chrome.
        panel.isOpaque = false
        panel.hasShadow = true
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.minSize = NSSize(width: 380, height: 400)
        panel.isReleasedWhenClosed = false
        panel.isMovableByWindowBackground = false
        panel.delegate = self
        panel.setFrameAutosaveName("FoldnotePanel")
        if !panel.setFrameUsingName("FoldnotePanel") { panel.center() }
        panel.backgroundColor = .clear
        panel.contentView = WindowContentView(frame: panel.contentView!.bounds, editor: webView)
        applyNativeAppearance(appearancePreferences.selectedTheme)
        applyWindowStyle()
        panel.hideAction = { [weak self] in self?.hideAfterFlush() }
    }

    private func buildMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = StatusItemIcon.make()
        statusItem.button?.imageScaling = .scaleNone
        statusItem.button?.imagePosition = .imageOnly
        statusItem.button?.toolTip = "Banana Notes · ⌃⌥Space to show or hide"
        let menu = NSMenu()
        menu.addItem(item("Show / Hide Banana Notes", #selector(togglePanel), key: ""))
        menu.addItem(item("New Note", #selector(newNote), key: "n"))
        menu.addItem(item("Notes", #selector(openExplorer), key: ""))
        menu.addItem(item("Settings…", #selector(openThemes), key: ""))
        menu.addItem(item("Reset Window Effects", #selector(resetWindowEffects), key: ""))
        menu.addItem(item("Shortcuts", #selector(showHelp), key: ""))
        menu.addItem(.separator())
        menu.addItem(item("Open Data Folder", #selector(openDataFolder), key: ""))
        menu.addItem(.separator())
        menu.addItem(item("Quit Banana Notes", #selector(quit), key: "q"))
        if !hotkeyAvailable {
            menu.addItem(.separator())
            menu.addItem(item("⌃⌥Space unavailable — use this menu to open Banana Notes", #selector(togglePanel), key: ""))
        }
        statusItem.menu = menu

        let mainMenu = NSMenu()
        let appRoot = NSMenuItem(title: "Banana Notes", action: nil, keyEquivalent: "")
        let appMenu = NSMenu(title: "Banana Notes")
        appMenu.addItem(item("Settings…", #selector(openThemes), key: ","))
        appMenu.addItem(item("Reset Window Effects", #selector(resetWindowEffects), key: ""))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Quit Banana Notes", #selector(quit), key: "q"))
        appRoot.submenu = appMenu
        mainMenu.addItem(appRoot)

        let editRoot = NSMenuItem()
        editRoot.submenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", #selector(UndoManager.undo), "z"), ("Redo", #selector(UndoManager.redo), "Z"), ("Cut", #selector(NSText.cut(_:)), "x"), ("Copy", #selector(NSText.copy(_:)), "c"), ("Paste", #selector(NSText.paste(_:)), "v"), ("Select All", #selector(NSText.selectAll(_:)), "a")] {
            let menuItem = NSMenuItem(title: title, action: action, keyEquivalent: key)
            menuItem.keyEquivalentModifierMask = title == "Redo" ? [.command, .shift] : .command
            editRoot.submenu?.addItem(menuItem)
        }
        editRoot.submenu?.addItem(.separator())
        let copyAs = NSMenuItem(title: "Copy As", action: nil, keyEquivalent: "")
        let copyMenu = NSMenu(title: "Copy As")
        copyMenu.addItem(item("Markdown", #selector(copyMarkdown), key: ""))
        let formatted = item("Formatted Text", #selector(copyFormatted), key: "c")
        formatted.keyEquivalentModifierMask = [.command, .option]
        copyMenu.addItem(formatted)
        copyMenu.addItem(item("HTML Source", #selector(copyHTML), key: ""))
        copyMenu.addItem(item("Plain Text", #selector(copyPlainText), key: ""))
        copyAs.submenu = copyMenu
        editRoot.submenu?.addItem(copyAs)
        editRoot.submenu?.addItem(item("Copy Entire Note as Markdown", #selector(copyWholeNote), key: ""))
        mainMenu.addItem(editRoot)
        let viewRoot = NSMenuItem(title: "View", action: nil, keyEquivalent: "")
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(item("Bigger Text", #selector(biggerText), key: "+"))
        let biggerAlias = item("Bigger Text", #selector(biggerText), key: "=")
        biggerAlias.isHidden = true; biggerAlias.allowsKeyEquivalentWhenHidden = true
        viewMenu.addItem(biggerAlias)
        viewMenu.addItem(item("Smaller Text", #selector(smallerText), key: "-"))
        viewMenu.addItem(item("Actual Text Size", #selector(actualTextSize), key: "0"))
        viewRoot.submenu = viewMenu; mainMenu.addItem(viewRoot)
        let windowRoot = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(item("Close Window", #selector(hideAfterFlushMenu), key: "w"))
        windowRoot.submenu = windowMenu
        mainMenu.addItem(windowRoot)
        NSApp.mainMenu = mainMenu
    }

    private func item(_ title: String, _ action: Selector, key: String) -> NSMenuItem {
        let result = NSMenuItem(title: title, action: action, keyEquivalent: key)
        result.target = self
        return result
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
    @objc private func quit() { quitAfterFlush() }
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

    private func quitAfterFlush() {
        flushThen { [weak self] result in
            guard let self else { return }
            switch result {
            case .success: NSApp.terminate(nil)
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
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else {
            replyHandler(nil, "Invalid native request."); return
        }
        do {
            switch action {
            case "load":
                let library = try store.load()
                let state: [String: Any] = ["library": library as Any? ?? NSNull(), "pinned": pinned,
                              "hotkey": "⌃⌥Space", "hotkeyAvailable": hotkeyAvailable,
                              "hotkeyStatus": hotkeyAvailable ? "⌃⌥Space toggles Banana Notes." : "⌃⌥Space could not be registered. Use the Banana Notes menu bar icon to open the app.",
                              "dataDirectory": store.directory.path, "themeID": appearancePreferences.selectedID,
                              "themeWarning": appearancePreferences.catalogError as Any? ?? NSNull(),
                              "focused": windowFocus.isFocused, "windowStyle": windowStylePreferences.style.bridgeValue,
                              "fontSize": fontSizePreferences.size, "ocrEnabled": featurePreferences.ocrEnabled,
                              "featureWarning": featureSetupError as Any? ?? NSNull()]
                replyHandler(state.merging(features?.preferences ?? [:]) { _, new in new }, nil)
            case "save":
                guard let library = body["library"] else { throw StoreError(message: "Missing library payload.") }
                try store.save(library)
                replyHandler(["saved": true], nil)
            case "hide":
                hideAfterFlush(); replyHandler(["ok": true], nil)
            case "dragRegion":
                guard let rect = body["rect"] as? [String: Double],
                      let x = rect["x"], let y = rect["y"], let width = rect["width"], let height = rect["height"],
                      let content = panel?.contentView as? WindowContentView,
                      content.updateDragRegion(NSRect(x: CGFloat(x), y: CGFloat(y), width: CGFloat(width), height: CGFloat(height))) else {
                    throw StoreError(message: "The toolbar drag area is invalid.")
                }
                replyHandler(["ok": true], nil)
            case "pin":
                guard let value = body["pinned"] as? Bool else { throw StoreError(message: "Pinned must be a boolean.") }
                pinned = value
                UserDefaults.standard.set(pinned, forKey: "pinned")
                panel.hidesOnDeactivate = false
                replyHandler(["pinned": pinned], nil)
            case "featurePreferences":
                try featurePreferences.setOCR(body["ocrEnabled"])
                replyHandler(["ocrEnabled": featurePreferences.ocrEnabled], nil)
            case "clipboard":
                guard let content = body["content"] as? [String: Any] else { throw StoreError(message: "Clipboard content is required.") }
                try ClipboardContent(content).write()
                replyHandler(["copied": true], nil)
            case "fontSize":
                try fontSizePreferences.save(body["fontSize"])
                replyHandler(["fontSize": fontSizePreferences.size], nil)
            case "windowStyle":
                guard let fields = body["style"] as? [String: Any] else { throw StoreError(message: "Window effect values are required.") }
                try windowStylePreferences.save(fields)
                applyWindowStyle()
                replyHandler(["windowStyle": windowStylePreferences.style.bridgeValue], nil)
            case "theme":
                guard let id = body["themeID"] as? String else { throw StoreError(message: "A theme ID is required.") }
                let theme = try appearancePreferences.select(id)
                applyNativeAppearance(theme)
                replyHandler(["themeID": appearancePreferences.selectedID], nil)
            case "export":
                guard let notes = body["notes"] as? [[String: Any]] else { throw StoreError(message: "Export notes must be an array.") }
                try export(notes: notes) { result in
                    switch result {
                    case .success(let exported): replyHandler(["exported": exported], nil)
                    case .failure(let error): replyHandler(nil, error.localizedDescription)
                    }
                }
            case "openData":
                NSWorkspace.shared.open(store.directory); replyHandler(["ok": true], nil)
            case "ready":
                commandsReady = true
                let pending = queuedCommands
                queuedCommands.removeAll()
                pending.forEach(evaluateCommand)
                updateWindowFocus()
                publishFocus()
                replyHandler(["ok": true], nil)
            case "quit":
                replyHandler(["ok": true], nil)
                DispatchQueue.main.async { self.quitAfterFlush() }
            default:
                guard let features, try features.handle(action: action, body: body, window: panel, ocrEnabled: featurePreferences.ocrEnabled,
                    presenting: { [weak self] value in self?.presentingNativeUI = value }, reply: replyHandler) else {
                    throw StoreError(message: featureSetupError ?? "Unknown native action: \(action)")
                }
            }
        } catch { replyHandler(nil, error.localizedDescription) }
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
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: OSType(kEventHotKeyPressed))
        let callback: EventHandlerProcPtr = { _, event, userData in
            guard let event, let userData else { return OSStatus(eventNotHandledErr) }
            var identifier = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                                           MemoryLayout<EventHotKeyID>.size, nil, &identifier)
            guard status == noErr, identifier.id == 1 else { return OSStatus(eventNotHandledErr) }
            let delegate = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
            Task { @MainActor in delegate.togglePanel() }
            return noErr
        }
        let handlerStatus = InstallEventHandler(GetApplicationEventTarget(), callback, 1, &eventType,
                                                Unmanaged.passUnretained(self).toOpaque(), &eventHandler)
        guard handlerStatus == noErr else { hotkeyAvailable = false; return }
        let identifier = EventHotKeyID(signature: OSType(0x464E4F54), id: 1)
        let status = RegisterEventHotKey(UInt32(kVK_Space), UInt32(controlKey | optionKey), identifier,
                                         GetApplicationEventTarget(), 0, &hotKeyRef)
        hotkeyAvailable = status == noErr
        if !hotkeyAvailable, let eventHandler { RemoveEventHandler(eventHandler); self.eventHandler = nil }
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
