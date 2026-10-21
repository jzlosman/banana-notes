import Foundation
import WebKit

final class FontSchemeHandler: NSObject, WKURLSchemeHandler {
    private let store: NoteFontStore
    private let lock = NSRecursiveLock()
    private var cancelled = Set<ObjectIdentifier>()

    init(store: NoteFontStore) { self.store = store; super.init() }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        lock.lock(); cancelled.remove(key); lock.unlock()
        do {
            guard let requestURL = urlSchemeTask.request.url else { throw NoteFontError(message: "Missing font URL.") }
            let file = try store.resolveFontURL(requestURL)
            let data = try Data(contentsOf: file, options: [.mappedIfSafe])
            var headers = ["Content-Type": "font/woff2", "Content-Length": String(data.count), "Cache-Control": "public, max-age=31536000, immutable",
                           "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "X-Content-Type-Options": "nosniff"]
            let method = urlSchemeTask.request.httpMethod?.uppercased() ?? "GET"
            guard ["GET", "HEAD", "OPTIONS"].contains(method) else { throw NoteFontError(message: "Unsupported font request method.") }
            if method == "OPTIONS" {
                headers["Access-Control-Allow-Headers"] = "Content-Type, Range"
                headers["Content-Length"] = "0"
            }
            let response = HTTPURLResponse(url: requestURL, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
            deliver(urlSchemeTask, key: key) { urlSchemeTask.didReceive(response) }
            if method == "GET" { deliver(urlSchemeTask, key: key) { urlSchemeTask.didReceive(data) } }
            deliver(urlSchemeTask, key: key) { urlSchemeTask.didFinish() }
        } catch {
            guard let url = urlSchemeTask.request.url else { return }
            deliver(urlSchemeTask, key: key) {
                let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": "0", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"])!
                urlSchemeTask.didReceive(response)
            }
            deliver(urlSchemeTask, key: key) { urlSchemeTask.didFinish() }
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        lock.lock(); cancelled.insert(ObjectIdentifier(urlSchemeTask as AnyObject)); lock.unlock()
    }

    // Serialize callback delivery with stop(): once stop returns, no callback can begin.
    private func deliver(_ task: WKURLSchemeTask, key: ObjectIdentifier, callbacks: () -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard !cancelled.contains(key) else { return }
        callbacks()
    }
}
