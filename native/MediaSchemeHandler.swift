import Foundation
import WebKit

final class MediaSchemeHandler: NSObject, WKURLSchemeHandler {
    private let store: any AttachmentRepository
    private let lock = NSRecursiveLock()
    private var cancelled = Set<ObjectIdentifier>()

    init(store: any AttachmentRepository) { self.store = store; super.init() }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        lock.lock(); cancelled.remove(key); lock.unlock()
        do {
            guard let requestURL = urlSchemeTask.request.url else { throw AttachmentError(message: "Missing media URL.") }
            let (file, mime) = try store.resolveAssetURL(requestURL)
            let data = try Data(contentsOf: file, options: [.mappedIfSafe])
            let requestedRange = urlSchemeTask.request.value(forHTTPHeaderField: "Range")
            let range: Range<Int>?
            do { range = try Self.byteRange(requestedRange, length: data.count) }
            catch {
                deliver(urlSchemeTask, key: key) {
                    let response = HTTPURLResponse(url: requestURL, statusCode: 416, httpVersion: "HTTP/1.1", headerFields: [
                        "Content-Range": "bytes */\(data.count)", "Content-Length": "0", "Accept-Ranges": "bytes", "Cache-Control": "no-store"
                    ])!
                    urlSchemeTask.didReceive(response)
                }
                deliver(urlSchemeTask, key: key) {
                    urlSchemeTask.didFinish()
                }
                return
            }
            let body = range.map { data.subdata(in: $0) } ?? data
            var headers = ["Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Length": String(body.count)]
            let status: Int
            if let range {
                status = 206
                headers["Content-Range"] = "bytes \(range.lowerBound)-\(range.upperBound - 1)/\(data.count)"
            } else { status = 200 }
            let response = HTTPURLResponse(url: requestURL, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
            deliver(urlSchemeTask, key: key) { urlSchemeTask.didReceive(response) }
            deliver(urlSchemeTask, key: key) { urlSchemeTask.didReceive(body) }
            deliver(urlSchemeTask, key: key) { urlSchemeTask.didFinish() }
        } catch {
            guard let url = urlSchemeTask.request.url else { return }
            deliver(urlSchemeTask, key: key) {
                let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": "0", "Cache-Control": "no-store"])!
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

    static func byteRange(_ header: String?, length: Int) throws -> Range<Int>? {
        guard let header else { return nil }
        guard length > 0, header.hasPrefix("bytes="), !header.contains(",") else { throw AttachmentError(message: "Unsatisfiable byte range.") }
        let parts = header.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2 else { throw AttachmentError(message: "Invalid byte range.") }
        if parts[0].isEmpty {
            guard let suffix = Int(parts[1]), suffix > 0 else { throw AttachmentError(message: "Invalid byte range.") }
            return max(0, length - min(suffix, length))..<length
        }
        guard let start = Int(parts[0]), start >= 0, start < length else { throw AttachmentError(message: "Unsatisfiable byte range.") }
        let end: Int
        if parts[1].isEmpty { end = length - 1 }
        else {
            guard let requestedEnd = Int(parts[1]), requestedEnd >= start else { throw AttachmentError(message: "Invalid byte range.") }
            end = min(requestedEnd, length - 1)
        }
        return start..<(end + 1)
    }
}
