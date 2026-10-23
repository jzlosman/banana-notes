import AppKit
import WebKit

/// Owns the concrete AppKit/WKWebView construction for the floating note surface.
@MainActor
final class NotePanelController {
    let panel: NotePanel
    let webView: WKWebView

    init(features: NativeFeatures?,
         windowDelegate: NSWindowDelegate, navigationDelegate: WKNavigationDelegate,
         uiDelegate: WKUIDelegate, messageHandler: WKScriptMessageHandlerWithReply,
         hideAction: @escaping () -> Void) {
        let configuration = WKWebViewConfiguration()
        features?.configureMedia(configuration)
        configuration.userContentController.addScriptMessageHandler(messageHandler, contentWorld: .page, name: "native")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = navigationDelegate
        webView.uiDelegate = uiDelegate
        #if DEBUG
        let environment = ProcessInfo.processInfo.environment
        webView.isInspectable = (environment["BANANA_NOTES_DEBUG"] ?? environment["FOLDNOTE_DEBUG"]) == "1"
        #else
        webView.isInspectable = false
        #endif
        webView.setValue(false, forKey: "drawsBackground")

        panel = NotePanel(contentRect: NSRect(x: 0, y: 0, width: 540, height: 650),
                          styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
        panel.title = "Banana Notes"
        panel.isOpaque = false
        panel.hasShadow = true
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.minSize = NSSize(width: 380, height: 400)
        panel.isReleasedWhenClosed = false
        panel.isMovableByWindowBackground = false
        panel.delegate = windowDelegate
        panel.setFrameAutosaveName("FoldnotePanel")
        if !panel.setFrameUsingName("FoldnotePanel") { panel.center() }
        panel.backgroundColor = .clear
        panel.contentView = WindowContentView(frame: panel.contentView!.bounds, editor: webView)
        panel.hideAction = hideAction
    }
}
