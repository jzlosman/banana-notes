import AppKit
import CoreFoundation
import WebKit

final class TasksPanel: NSPanel {
    var hideAction: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
    override func cancelOperation(_ sender: Any?) { hideAction?() }
}

private final class TasksDragView: NSView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
}

private final class TasksContentView: NSView {
    private let webView: WKWebView
    private let effectView = NSVisualEffectView(frame: .zero)
    private let dragView = TasksDragView(frame: .zero)
    private let dragStripHeight: CGFloat = 54
    var surfaceColor: NSColor = .windowBackgroundColor { didSet { needsDisplay = true } }

    override var isFlipped: Bool { true }
    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() { layer?.backgroundColor = surfaceColor.cgColor }

    init(frame: NSRect, webView: WKWebView) {
        self.webView = webView
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = 12
        layer?.masksToBounds = true
        effectView.frame = bounds
        effectView.autoresizingMask = [.width, .height]
        effectView.material = .underWindowBackground
        effectView.blendingMode = .behindWindow
        effectView.state = .active
        effectView.isHidden = true
        addSubview(effectView)
        webView.frame = bounds
        webView.autoresizingMask = [.width, .height]
        addSubview(webView)
        addSubview(dragView)
    }

    func updateDragRegion(_ values: [String: Any]?) -> Bool {
        guard let values else { dragView.frame = .zero; return true }
        func number(_ key: String) -> CGFloat? {
            guard let number = values[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue.isFinite else { return nil }
            return CGFloat(number.doubleValue)
        }
        guard let x = number("x"), let y = number("y"), let width = number("width"), let height = number("height"),
              x >= 0, y >= 0, width > 0, height > 0, y + height <= dragStripHeight,
              x + width <= bounds.width, bounds.height >= dragStripHeight else { return false }
        dragView.frame = NSRect(x: x, y: y, width: width, height: height)
        return true
    }

    override func resizeSubviews(withOldSize oldSize: NSSize) {
        super.resizeSubviews(withOldSize: oldSize)
        if oldSize != bounds.size { dragView.frame = .zero }
    }

    required init?(coder: NSCoder) { nil }
}

@MainActor
final class TasksWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private let indexURL: URL
    private let webDirectory: URL
    private let catalog: TasksThemeCatalog
    private let identities: TasksIdentitySource
    private var preferences: TasksPreferences
    private var bridgeHandler: TasksBridgeMessageAdapter!
    private var userContentController: WKUserContentController!
    private var pageReady = false
    private var queuedEvents: [[String: Any]] = []
    private var blurTimer: Timer?
    private var flushTimer: Timer?
    private var focusState = TasksFocusState()
    private var flushState = TasksFlushState()
    private var flushCompletions: [(Bool) -> Void] = []
    private var showingRecovery = false

    private(set) var webView: WKWebView!
    var router: TasksBridgeRouter? { didSet { bridgeHandler.router = router } }
    var onOpenDataFolder: (() -> Void)?
    var onError: ((String) -> Void)?
    var onPinnedChange: ((Bool) -> Void)?

    init(webDirectory: URL, catalog: TasksThemeCatalog, preferences: TasksPreferences,
         identities: TasksIdentitySource = UUIDTasksIdentitySource()) {
        self.webDirectory = webDirectory
        self.indexURL = webDirectory.appendingPathComponent("tasks.html")
        self.catalog = catalog
        self.identities = identities
        self.preferences = preferences

        let window = TasksPanel(contentRect: NSRect(x: 0, y: 0, width: 600, height: 740),
                                styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
        window.title = "Banana Tasks"
        window.isOpaque = false
        window.hasShadow = true
        window.isFloatingPanel = preferences.pinned
        window.hidesOnDeactivate = false
        window.level = preferences.pinned ? .floating : .normal
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.minSize = NSSize(width: 380, height: 400)
        window.isReleasedWhenClosed = false
        window.isMovableByWindowBackground = false
        window.center()
        window.backgroundColor = .clear

        super.init(window: window)
        let configuration = WKWebViewConfiguration()
        userContentController = configuration.userContentController
        bridgeHandler = TasksBridgeMessageAdapter(bundledIndexURL: indexURL)
        userContentController.addScriptMessageHandler(bridgeHandler, contentWorld: .page, name: "bananaTasks")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.underPageBackgroundColor = .clear
        #if DEBUG
        webView.isInspectable = ProcessInfo.processInfo.environment["BANANA_TASKS_DEBUG"] == "1"
        #else
        webView.isInspectable = false
        #endif
        let content = TasksContentView(frame: window.contentView?.bounds ?? .zero, webView: webView)
        window.contentView = content
        window.delegate = self
        window.hideAction = { [weak self] in self?.hideAfterFlush() }
        applyPreferences(preferences)
        webView.loadFileURL(indexURL, allowingReadAccessTo: webDirectory)
    }

    required init?(coder: NSCoder) { nil }

    var isPinned: Bool { preferences.pinned }
    var isVisible: Bool { window?.isVisible == true }

    func show() {
        guard let window else { return }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        webView.window?.makeFirstResponder(webView)
        focusChanged(window.isKeyWindow)
    }

    func toggleVisibility() { isVisible ? hideAfterFlush() : show() }

    func applyPreferences(_ newValue: TasksPreferences) {
        preferences = newValue
        if let window {
            (window as? TasksPanel)?.isFloatingPanel = newValue.pinned
            window.level = newValue.pinned ? .floating : .normal
            if let theme = catalog.theme(for: newValue.appearanceTheme) {
                window.appearance = NSAppearance(named: theme.appearance == "dark" ? .darkAqua : .aqua)
                if let value = UInt32(theme.colors["paper"]!.dropFirst(), radix: 16) {
                    (window.contentView as? TasksContentView)?.surfaceColor = NSColor(
                        calibratedRed: CGFloat((value >> 16) & 255) / 255,
                        green: CGFloat((value >> 8) & 255) / 255,
                        blue: CGFloat(value & 255) / 255, alpha: 1)
                }
            } else {
                window.appearance = nil
                (window.contentView as? TasksContentView)?.surfaceColor = .windowBackgroundColor
            }
        }
        onPinnedChange?(newValue.pinned)
    }

    func setDragRegion(_ value: [String: Any]?) -> Bool {
        (window?.contentView as? TasksContentView)?.updateDragRegion(value) ?? false
    }

    func dispatchCommand(_ command: String) {
        guard ["newTask", "settings", "toggleTimer", "togglePin"].contains(command) else { return }
        emit(["kind": "command", "command": command])
    }

    func hideAfterFlush() {
        requestFlush { [weak self] saved in
            guard let self else { return }
            if saved { self.window?.orderOut(nil) }
            else {
                self.presentSaveRecovery(retry: { [weak self] in self?.hideAfterFlush() },
                                         keepOpen: { [weak self] in self?.show() })
            }
        }
    }

    func requestTermination(_ reply: @escaping (Bool) -> Void) {
        requestFlush { [weak self] saved in
            guard let self else { reply(false); return }
            if saved { reply(true) }
            else {
                self.presentSaveRecovery(retry: { [weak self] in self?.requestTermination(reply) },
                                         keepOpen: { reply(false) })
            }
        }
    }

    func requestFlush(_ completion: @escaping (Bool) -> Void) {
        guard pageReady else { completion(false); return }
        if flushState.requestID != nil {
            flushCompletions.append(completion)
            return
        }
        let id = identities.next()
        guard flushState.begin(id) else { completion(false); return }
        flushCompletions = [completion]
        emit(["kind": "flush", "requestID": id])
        let timer = Timer(timeInterval: 5, target: self, selector: #selector(flushTimedOut), userInfo: nil, repeats: false)
        flushTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func acknowledgeFlush(requestID: String, saved: Bool) {
        guard let savedResult = flushState.acknowledge(requestID: requestID, saved: saved) else { return }
        flushTimer?.invalidate()
        flushTimer = nil
        let completions = flushCompletions
        flushCompletions.removeAll()
        completions.forEach { $0(savedResult) }
    }

    func presentSaveRecovery(retry: @escaping () -> Void, keepOpen: @escaping () -> Void) {
        guard !showingRecovery, let window else { keepOpen(); return }
        showingRecovery = true
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Banana Tasks stayed open because changes were not saved."
        alert.informativeText = "Your tasks remain visible. Retry saving, keep the window open, or inspect the Tasks data folder."
        alert.addButton(withTitle: "Retry Save")
        alert.addButton(withTitle: "Keep Open")
        alert.addButton(withTitle: "Open Data Folder")
        alert.beginSheetModal(for: window) { [weak self] response in
            guard let self else { keepOpen(); return }
            self.showingRecovery = false
            switch response {
            case .alertFirstButtonReturn: retry()
            case .alertThirdButtonReturn: self.onOpenDataFolder?(); keepOpen()
            default: keepOpen()
            }
        }
    }

    func shutdown() {
        blurTimer?.invalidate(); blurTimer = nil
        flushTimer?.invalidate(); flushTimer = nil
        webView.stopLoading()
        userContentController.removeScriptMessageHandler(forName: "bananaTasks", contentWorld: .page)
        bridgeHandler.router = nil
        router = nil
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView = nil
        window?.delegate = nil
        window?.close()
    }

    func windowDidBecomeKey(_ notification: Notification) { focusChanged(true) }
    func windowDidResignKey(_ notification: Notification) { focusChanged(false) }

    func windowShouldClose(_ sender: NSWindow) -> Bool { hideAfterFlush(); return false }
    func windowDidResize(_ notification: Notification) { _ = (window?.contentView as? TasksContentView)?.updateDragRegion(nil) }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        emit(["kind": "focus", "focused": window?.isKeyWindow ?? false])
        let pending = queuedEvents
        queuedEvents.removeAll()
        pending.forEach(dispatchEvent)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        pageReady = false
        onError?("Banana Tasks could not load its bundled interface.")
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, url.isFileURL,
              url.resolvingSymlinksInPath().standardizedFileURL == indexURL.resolvingSymlinksInPath().standardizedFileURL,
              navigationAction.targetFrame?.isMainFrame == true else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    private func focusChanged(_ isKeyWindow: Bool) {
        blurTimer?.invalidate(); blurTimer = nil
        let changed = focusState.update(isKeyWindow: isKeyWindow, at: ProcessInfo.processInfo.systemUptime)
        if changed { emit(["kind": "focus", "focused": focusState.isFocused]) }
        guard let deadline = focusState.lossDeadline else { return }
        let timer = Timer(timeInterval: max(0, deadline - ProcessInfo.processInfo.systemUptime),
                          target: self, selector: #selector(commitBlur), userInfo: nil, repeats: false)
        blurTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    @objc private func commitBlur() {
        blurTimer = nil
        if window?.isKeyWindow == true { focusChanged(true); return }
        if focusState.settle(at: ProcessInfo.processInfo.systemUptime) {
            emit(["kind": "focus", "focused": false])
            if !preferences.pinned && !showingRecovery { hideAfterFlush() }
        } else if let deadline = focusState.lossDeadline {
            let timer = Timer(timeInterval: max(0, deadline - ProcessInfo.processInfo.systemUptime),
                              target: self, selector: #selector(commitBlur), userInfo: nil, repeats: false)
            blurTimer = timer
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    @objc private func flushTimedOut() {
        guard let requestID = flushState.requestID else { return }
        acknowledgeFlush(requestID: requestID, saved: false)
    }

    private func emit(_ detail: [String: Any]) {
        guard pageReady else { queuedEvents.append(detail); return }
        dispatchEvent(detail)
    }

    private func dispatchEvent(_ detail: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: detail, options: [.fragmentsAllowed]) else { return }
        let base64 = data.base64EncodedString()
        let script = "window.dispatchEvent(new CustomEvent('banana-tasks-event',{detail:JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('" + base64 + "'),c=>c.charCodeAt(0))))}));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }
}
