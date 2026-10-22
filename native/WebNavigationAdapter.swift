import AppKit
import WebKit

@MainActor
final class WebNavigationAdapter: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let bundledRoot: URL

    init(bundledRoot: URL) {
        self.bundledRoot = bundledRoot
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let kind: WebNavigationKind = navigationAction.navigationType == .linkActivated ? .linkActivated : .programmatic
        switch WebNavigationPolicy.decide(url: navigationAction.request.url, sourceURL: navigationAction.sourceFrame.request.url,
                                         kind: kind, bundledRoot: bundledRoot) {
        case .allowBundled: decisionHandler(.allow)
        case .openExternal(let url): NSWorkspace.shared.open(url); decisionHandler(.cancel)
        case .cancel: decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if case .openExternal(let url) = WebNavigationPolicy.decide(
            url: navigationAction.request.url, sourceURL: navigationAction.sourceFrame.request.url,
            kind: .newWindow, bundledRoot: bundledRoot) {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
}
