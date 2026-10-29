import AppKit
import WebKit

@MainActor
final class ViewerWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private let indexURL: URL
    private let webDirectory: URL
    private let catalog: ViewerCatalog
    private let preferencesStore: ViewerPreferencesStore
    private var resourceHandler: ViewerResourceSchemeHandler!
    private var userContentController: WKUserContentController!
    private var bridgeMessageHandler: ViewerBridgeMessageHandler!
    private let effectView = NSVisualEffectView(frame: .zero)
    private var currentURL: URL?
    private var securityScopedURL: URL?
    private var securityScopedAccess = false
    private var currentFingerprint: ViewerFileFingerprint?
    private var documentRoot: ViewerRasterResourceReader?
    private var currentDocument: ViewerDocument = .empty
    private var pageReady = false
    private var queuedMenuCommands: [String] = []
    private var filePoll: Timer?

    var onOpenDocument: ((URL) -> Void)?
    var onOpenPanel: (() -> Void)?
    var onPreferencesUpdated: (() -> Void)?
    var onClose: (() -> Void)?

    private(set) var webView: WKWebView!
    var documentURL: URL? { currentURL }

    init(webDirectory: URL, catalog: ViewerCatalog, preferencesStore: ViewerPreferencesStore) {
        self.webDirectory = webDirectory
        self.indexURL = webDirectory.appendingPathComponent("viewer.html")
        self.catalog = catalog
        self.preferencesStore = preferencesStore

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 760),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "Banana Viewer"
        window.minSize = NSSize(width: 380, height: 400)
        window.isReleasedWhenClosed = false
        window.center()
        window.delegate = nil

        super.init(window: window)
        self.resourceHandler = ViewerResourceSchemeHandler()
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(resourceHandler, forURLScheme: "banana-viewer-resource")
        userContentController = configuration.userContentController
        bridgeMessageHandler = ViewerBridgeMessageHandler(controller: self)
        userContentController.addScriptMessageHandler(bridgeMessageHandler, contentWorld: .page, name: "viewer")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.underPageBackgroundColor = .clear
        window.delegate = self
        let content = NSView(frame: window.contentView?.bounds ?? .zero)
        content.autoresizingMask = [.width, .height]
        effectView.frame = content.bounds
        effectView.autoresizingMask = [.width, .height]
        effectView.material = .underWindowBackground
        effectView.blendingMode = .behindWindow
        effectView.state = .active
        effectView.alphaValue = 0
        webView.frame = content.bounds
        webView.autoresizingMask = [.width, .height]
        content.addSubview(effectView)
        content.addSubview(webView)
        window.contentView = content
        applyPreferences()
        webView.loadFileURL(indexURL, allowingReadAccessTo: webDirectory)
    }

    required init?(coder: NSCoder) { nil }


    func show() {
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
    }

    func open(_ url: URL, canonicalURL: URL? = nil) {
        stopObserving()
        if securityScopedAccess, let securityScopedURL { securityScopedURL.stopAccessingSecurityScopedResource() }
        let canonical = canonicalURL ?? ViewerDocumentReader.canonicalURL(for: url)
        currentURL = canonical
        securityScopedURL = url
        securityScopedAccess = url.startAccessingSecurityScopedResource()
        resourceHandler.clearRoot()
        documentRoot = nil
        currentFingerprint = nil
        currentDocument = .error(name: canonical.lastPathComponent, message: ViewerError.unavailable.localizedDescription)
        refreshDocument(forcePublish: true)
        if ViewerDocumentReader.supportedExtensions.contains(canonical.pathExtension.lowercased()) {
            filePoll = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.refreshDocument(forcePublish: false) }
            }
            filePoll?.tolerance = 0.2
        }
        preferencesStore.recordRecent(canonical)
        applyPreferences()
    }

    func reloadDocument() {
        guard currentURL != nil else { publishState(); return }
        refreshDocument(forcePublish: true)
    }

    func publishState() {
        guard let webView, webView.isLoading == false else { return }
        do {
            let snapshot = ViewerSnapshot(document: currentDocument, preferences: preferencesStore.preferences)
            let data = try JSONEncoder().encode(snapshot)
            let script = "window.dispatchEvent(new CustomEvent('banana-viewer-state',{detail:JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('" + data.base64EncodedString() + "'),c=>c.charCodeAt(0))))}));"
            webView.evaluateJavaScript(script, completionHandler: nil)
        } catch { NSLog("Banana Viewer could not publish its state: %@", error.localizedDescription) }
    }

    func broadcastPreferences() {
        applyPreferences()
        publishState()
    }

    func dispatchMenuCommand(_ command: String) {
        let allowed = Set(["settings", "find", "source", "zoomIn", "zoomOut", "zoomReset"])
        guard allowed.contains(command) else { return }
        guard pageReady else { queuedMenuCommands.append(command); return }
        deliverMenuCommand(command)
    }

    func revealDocument() {
        guard let currentURL else { return }
        NSWorkspace.shared.activateFileViewerSelecting([currentURL])
    }

    func windowDidBecomeKey(_ notification: Notification) { applyWindowEffects() }
    func windowDidResignKey(_ notification: Notification) { applyWindowEffects() }

    func windowWillClose(_ notification: Notification) {
        stopObserving()
        if securityScopedAccess, let securityScopedURL { securityScopedURL.stopAccessingSecurityScopedResource() }
        securityScopedAccess = false
        securityScopedURL = nil
        webView.stopLoading()
        userContentController.removeScriptMessageHandler(forName: "viewer", contentWorld: .page)
        bridgeMessageHandler.controller = nil
        bridgeMessageHandler = nil
        userContentController = nil
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.removeFromSuperview()
        webView = nil
        resourceHandler.clearRoot()
        documentRoot = nil
        currentFingerprint = nil
        currentDocument = .empty
        queuedMenuCommands.removeAll()
        pageReady = false
        window?.makeFirstResponder(nil)
        window?.delegate = nil
        window?.windowController = nil
        self.window = nil
        let close = onClose
        onOpenDocument = nil
        onOpenPanel = nil
        onPreferencesUpdated = nil
        onClose = nil
        close?()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        publishState()
        let pending = queuedMenuCommands
        queuedMenuCommands.removeAll()
        pending.forEach(deliverMenuCommand)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.navigationType == .linkActivated,
           let external = ViewerPolicy.explicitExternalURL(url.absoluteString) {
            NSWorkspace.shared.open(external)
            decisionHandler(.cancel)
            return
        }
        let isIndex = url.isFileURL && ViewerDocumentReader.canonicalURL(for: url) == ViewerDocumentReader.canonicalURL(for: indexURL)
        if navigationAction.targetFrame?.isMainFrame == true && isIndex {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.navigationType == .linkActivated,
              let href = navigationAction.request.url?.absoluteString,
              let external = ViewerPolicy.explicitExternalURL(href) else { return nil }
        NSWorkspace.shared.open(external)
        return nil
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame,
              let frameURL = message.frameInfo.request.url, frameURL.isFileURL,
              ViewerDocumentReader.canonicalURL(for: frameURL) == ViewerDocumentReader.canonicalURL(for: indexURL) else {
            replyHandler(nil, "Viewer requests are allowed only from the bundled viewer page.")
            return
        }
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else {
            replyHandler(nil, "The viewer request is malformed.")
            return
        }
        do {
            switch action {
            case "bootstrap":
                replyHandler(try viewerFoundationValue(ViewerSnapshot(document: currentDocument, preferences: preferencesStore.preferences)), nil)
            case "open":
                replyHandler(NSNull(), nil)
                onOpenPanel?()
            case "reload":
                reloadDocument()
                replyHandler(NSNull(), nil)
            case "preferences":
                let preferences = try ViewerPolicy.validateWirePreferences(body["preferences"] as Any, catalog: catalog)
                try preferencesStore.save(preferences)
                onPreferencesUpdated?()
                replyHandler(try viewerFoundationValue(ViewerSnapshot(document: currentDocument, preferences: preferences)), nil)
            case "openLink":
                guard let href = body["href"] as? String, href.utf8.count <= 8_192 else {
                    throw ViewerError.invalidResource
                }
                try openLink(href)
                replyHandler(NSNull(), nil)
            case "reveal":
                revealDocument()
                replyHandler(NSNull(), nil)
            default:
                replyHandler(nil, "This viewer action is not supported.")
            }
        } catch { replyHandler(nil, error.localizedDescription) }
    }

    private func openLink(_ href: String) throws {
        if let external = ViewerPolicy.explicitExternalURL(href) {
            NSWorkspace.shared.open(external)
            return
        }
        guard let currentURL, let target = ViewerPolicy.localMarkdownTarget(href: href, relativeTo: currentURL) else {
            throw ViewerError.invalidResource
        }
        onOpenDocument?(target)
    }

    private func refreshDocument(forcePublish: Bool) {
        guard let currentURL else { return }
        let observedFingerprint: ViewerFileFingerprint?
        if forcePublish {
            observedFingerprint = nil
        } else if let documentRoot {
            observedFingerprint = try? documentRoot.fingerprint(filename: currentURL.lastPathComponent)
        } else {
            observedFingerprint = try? ViewerDocumentReader.fingerprint(canonicalURL: currentURL)
        }
        if !forcePublish, let observedFingerprint, observedFingerprint == currentFingerprint { return }
        do {
            let result: ViewerReadResult
            if let documentRoot {
                result = try ViewerDocumentReader.read(canonicalURL: currentURL, using: documentRoot)
            } else {
                result = try ViewerDocumentReader.read(canonicalURL: currentURL)
            }
            let next = ViewerDocument.loaded(name: result.canonicalURL.lastPathComponent,
                                             markdown: result.markdown,
                                             revision: result.revision,
                                             resourceBaseURL: ViewerPolicy.resourceBaseURL)
            let changed = currentDocument != next
            currentFingerprint = result.fingerprint
            documentRoot = result.resourceRoot
            currentDocument = next
            resourceHandler.pinRoot(result.resourceRoot)
            window?.title = "\(result.canonicalURL.lastPathComponent) — Banana Viewer"
            if changed || forcePublish { publishState() }
        } catch let error as ViewerError {
            let next = ViewerDocument.error(name: currentURL.lastPathComponent, message: error.localizedDescription)
            currentFingerprint = observedFingerprint
            let changed = currentDocument != next
            currentDocument = next
            resourceHandler.clearRoot()
            window?.title = "\(currentURL.lastPathComponent) — Banana Viewer"
            if changed || forcePublish { publishState() }
        } catch {
            let next = ViewerDocument.error(name: currentURL.lastPathComponent, message: ViewerError.unavailable.localizedDescription)
            currentFingerprint = observedFingerprint
            let changed = currentDocument != next
            currentDocument = next
            resourceHandler.clearRoot()
            if changed || forcePublish { publishState() }
        }
    }

    private func applyPreferences() {
        guard let window else { return }
        let preferences = preferencesStore.preferences
        if preferences.themeID == "system" {
            window.appearance = nil
        } else if let theme = catalog.themes[preferences.themeID] {
            window.appearance = NSAppearance(named: theme.appearance == "dark" ? .darkAqua : .aqua)
        }
        applyWindowEffects()
    }

    private func applyWindowEffects() {
        guard let window else { return }
        let preferences = preferencesStore.preferences
        let plan = ViewerWindowSurfacePlan.make(preferences: preferences, isFocused: window.isKeyWindow)
        window.alphaValue = plan.foregroundAlpha
        window.backgroundColor = baseSurfaceColor.withAlphaComponent(plan.paperAlpha)
        window.isOpaque = plan.windowIsOpaque
        effectView.state = plan.showsVibrancy ? .active : .inactive
        effectView.alphaValue = plan.vibrancyAlpha
        effectView.isHidden = !plan.showsVibrancy
    }

    private func deliverMenuCommand(_ command: String) {
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('banana-viewer-command',{detail:'\(command)'}));", completionHandler: nil)
    }

    private var baseSurfaceColor: NSColor {
        let preferences = preferencesStore.preferences
        if preferences.themeID == "system" { return .windowBackgroundColor }
        guard let theme = catalog.themes[preferences.themeID],
              let hex = UInt32(theme.colors.paper.dropFirst(), radix: 16) else { return .windowBackgroundColor }
        return NSColor(calibratedRed: CGFloat((hex >> 16) & 255) / 255,
                       green: CGFloat((hex >> 8) & 255) / 255,
                       blue: CGFloat(hex & 255) / 255, alpha: 1)
    }

    private func stopObserving() {
        filePoll?.invalidate()
        filePoll = nil
    }
}

@MainActor
private final class ViewerBridgeMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var controller: ViewerWindowController?

    init(controller: ViewerWindowController) { self.controller = controller }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let controller else { replyHandler(nil, "The viewer window has closed."); return }
        controller.userContentController(userContentController, didReceive: message, replyHandler: replyHandler)
    }
}

private final class ViewerResourceSchemeHandler: NSObject, WKURLSchemeHandler {
    private let lock = NSLock()
    private var pinnedRoot: ViewerRasterResourceReader?

    func pinRoot(_ root: ViewerRasterResourceReader) {
        lock.lock()
        pinnedRoot = root
        lock.unlock()
    }

    func clearRoot() {
        lock.lock()
        pinnedRoot = nil
        lock.unlock()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        do {
            guard let requestURL = urlSchemeTask.request.url else { throw ViewerError.invalidResource }
            lock.lock()
            let pinnedRoot = self.pinnedRoot
            lock.unlock()
            guard let pinnedRoot else { throw ViewerError.invalidResource }
            let path = try ViewerPolicy.rasterPath(requestURL: requestURL)
            let image = try pinnedRoot.read(path)
            let response = URLResponse(url: requestURL, mimeType: image.mimeType,
                                       expectedContentLength: image.data.count, textEncodingName: nil)
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(image.data)
            urlSchemeTask.didFinish()
        } catch { urlSchemeTask.didFailWithError(error) }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
