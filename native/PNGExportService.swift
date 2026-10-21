import AppKit
import WebKit

struct NoteImageRequest {
    let html: String
    let title: String
    let backgroundStart: String
    let backgroundEnd: String
    let paper: String
    let text: String
    let accent: String
    let width: Int
    let padding: Int
}

enum PNGExportError: Error, LocalizedError {
    case invalidRequest(String), contentTooLarge, renderFailed(String), saveCancelled, renderInProgress
    var errorDescription: String? {
        switch self {
        case .invalidRequest(let reason): return reason
        case .contentTooLarge: return "This note is too long to export as one image. Shorten it or split it into multiple notes."
        case .renderFailed(let reason): return "The note image could not be rendered: \(reason)"
        case .saveCancelled: return "Image export was cancelled."
        case .renderInProgress: return "An image export is already being rendered."
        }
    }
}

@MainActor final class PNGExportService: NSObject, WKNavigationDelegate {
    private var navigation: CheckedContinuation<Void, Error>?
    private var activeWebView: WKWebView?
    private var hasStartedInitialNavigation = false

    init(configurationFactory: @escaping @MainActor () -> WKWebViewConfiguration = { WKWebViewConfiguration() },
         fontCSS: @escaping @MainActor () -> String = { ".content{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:500;font-size:15px;font-synthesis:weight style}.content strong,.content h1,.content h2,.content h3{font-weight:700}" }) {
        self.configurationFactory = configurationFactory
        self.fontCSS = fontCSS
        super.init()
    }
    private let configurationFactory: () -> WKWebViewConfiguration
    private let fontCSS: () -> String

    func render(request: NoteImageRequest) async throws -> Data {
        guard activeWebView == nil else { throw PNGExportError.renderInProgress }
        try validate(request)
        let config = configurationFactory()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: request.width, height: 1), configuration: config)
        activeWebView = view
        hasStartedInitialNavigation = false
        view.navigationDelegate = self
        view.setValue(false, forKey: "drawsBackground")
        defer {
            navigation = nil
            view.stopLoading()
            view.navigationDelegate = nil
            activeWebView = nil
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            navigation = continuation
            view.loadHTMLString(htmlDocument(request), baseURL: URL(string: "about:blank"))
            Task { @MainActor [weak self, weak view] in
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                guard let self, let view, self.activeWebView === view, let pending = self.navigation else { return }
                self.navigation = nil
                pending.resume(throwing: PNGExportError.renderFailed("Timed out loading note content."))
            }
        }
        let deadline = Date().addingTimeInterval(15)
        var dimensions: [String: Any] = [:]
        while Date() < deadline {
            do {
                let js = "JSON.stringify({ready:document.fonts.status==='loaded' && Array.from(document.fonts).every(f=>f.status!=='error') && Array.from(document.images).every(i=>i.complete && i.naturalWidth>0),width:Math.ceil(document.documentElement.scrollWidth),height:Math.ceil(document.documentElement.scrollHeight)})"
                let serialized = try await view.evaluateJavaScript(js) as? String ?? "{}"
                dimensions = try JSONSerialization.jsonObject(with: Data(serialized.utf8)) as? [String: Any] ?? [:]
                if dimensions["ready"] as? Bool == true { break }
            } catch { throw PNGExportError.renderFailed(error.localizedDescription) }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        guard dimensions["ready"] as? Bool == true else { throw PNGExportError.renderFailed("Timed out waiting for images and fonts to load.") }
        guard let height = dimensions["height"] as? CGFloat, let width = dimensions["width"] as? CGFloat,
              width >= 480, width <= 1200, height > 0, height <= 6000 else { throw PNGExportError.contentTooLarge }
        view.frame = CGRect(x: 0, y: 0, width: width, height: height)
        try await Task.sleep(nanoseconds: 100_000_000)
        let image = try await view.takeSnapshot(configuration: nil)
        guard let data = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) else {
            throw PNGExportError.renderFailed("PNG encoding failed")
        }
        return png
    }

    func export(request: NoteImageRequest, presenting window: NSWindow, completion: @escaping (Result<URL, Error>) -> Void) {
        Task { @MainActor in
            do {
                let data = try await render(request: request)
                let panel = NSSavePanel()
                panel.allowedContentTypes = [.png]
                panel.nameFieldStringValue = Self.safeFilename(request.title) + ".png"
                panel.canCreateDirectories = true
                panel.beginSheetModal(for: window) { response in
                    guard response == .OK, let url = panel.url else { completion(.failure(PNGExportError.saveCancelled)); return }
                    do { try data.write(to: url, options: .atomic); completion(.success(url)) }
                    catch { completion(.failure(error)) }
                }
            } catch { completion(.failure(error)) }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === activeWebView, let pending = self.navigation else { return }
        self.navigation = nil
        pending.resume()
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(webView, error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(webView, error) }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let isInitial = webView === activeWebView && !hasStartedInitialNavigation && action.request.url?.absoluteString == "about:blank"
        if isInitial { hasStartedInitialNavigation = true }
        decisionHandler(isInitial ? .allow : .cancel)
    }
    private func fail(_ webView: WKWebView, _ error: Error) {
        guard webView === activeWebView, let pending = navigation else { return }
        navigation = nil
        pending.resume(throwing: error)
    }

    private func validate(_ r: NoteImageRequest) throws {
        let colors = [r.backgroundStart, r.backgroundEnd, r.paper, r.text, r.accent]
        guard !r.html.isEmpty, r.html.utf8.count < 2_000_000,
              colors.allSatisfy({ $0.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil }),
              (480...1200).contains(r.width), (24...120).contains(r.padding), r.width > r.padding * 2, r.title.utf8.count <= 500 else {
            throw PNGExportError.invalidRequest("Image export settings or content are invalid.")
        }
        let forbidden = #"(?i)<\s*(script|iframe|object|embed|base|meta)\b|\s(?:on\w+)\s*=|<\s*link\b"#
        guard r.html.range(of: forbidden, options: .regularExpression) == nil else {
            throw PNGExportError.invalidRequest("Image content may not include scripts, frames, or event handlers.")
        }
        let hrefPattern = #"(?i)\bhref\s*=\s*([\"'])(.*?)\1|\bhref\s*=\s*([^\s>]+)"#
        for match in r.html.matches(pattern: hrefPattern) {
            guard let raw = match[2] ?? match[3], let scheme = URLComponents(string: raw)?.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else {
                throw PNGExportError.invalidRequest("Links must use http, https, or mailto and are never opened during export.")
            }
        }
        let srcPattern = #"(?i)\bsrc\s*=\s*([\"'])(.*?)\1|\bsrc\s*=\s*([^\s>]+)"#
        for match in r.html.matches(pattern: srcPattern) {
            guard let raw = match[2] ?? match[3], validImageSource(raw) else {
                throw PNGExportError.invalidRequest("Images must use managed media URLs or small, valid image data URLs.")
            }
        }
    }
    private func validImageSource(_ source: String) -> Bool {
        if source.range(of: #"^foldnote-asset://media/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(png|jpg|jpeg|gif|webp|heic|heif|mp3|m4a|wav|mp4|mov|webm)$"#, options: .regularExpression) != nil { return true }
        guard source.utf8.count <= 350_000,
              let match = source.range(of: #"^data:image/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+=*)$"#, options: [.regularExpression, .caseInsensitive]) else { return false }
        let parts = source[match].split(separator: ",", maxSplits: 1)
        guard parts.count == 2, let data = Data(base64Encoded: String(parts[1])), !data.isEmpty, data.count <= 256_000 else { return false }
        return data.starts(with: [0x89, 0x50, 0x4e, 0x47]) || data.starts(with: [0xff, 0xd8, 0xff]) || data.starts(with: [0x47, 0x49, 0x46, 0x38]) || (data.count >= 12 && String(data: data[8..<12], encoding: .ascii) == "WEBP")
    }
    private func htmlDocument(_ r: NoteImageRequest) -> String {
        let title = Self.escape(r.title)
        let content = Self.mediaPlaceholders(r.html)
        return """
        <!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src foldnote-asset: data:; font-src foldnote-font:; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'"><style>*{box-sizing:border-box}html,body{margin:0;width:max-content;min-width:\(r.width)px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:\(r.text)}body{padding:\(r.padding)px;background:linear-gradient(135deg,\(r.backgroundStart),\(r.backgroundEnd))}.card{width:\(r.width - 2*r.padding)px;border-radius:18px;overflow:hidden;background:\(r.paper);box-shadow:0 18px 48px #0003}.dots{height:32px;display:flex;align-items:center;gap:7px;padding:0 14px}.dot{width:9px;height:9px;border-radius:50%}.red{background:#ff5f57}.yellow{background:#febc2e}.green{background:#28c840}.title{font-weight:600;padding:3px 22px 12px;border-bottom:1px solid #0001}.content{padding:24px 28px;overflow-wrap:anywhere;line-height:1.65}pre{font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#0000000b;padding:14px;border-radius:8px}pre code{font:inherit}img{max-width:100%;height:auto}.content h1{line-height:1.25;margin:0 0 18px}.content a{color:\(r.accent)}.content ul[data-type=taskList]{list-style:none;padding:0;margin:14px 0}.content li[data-type=taskItem]{display:flex;align-items:flex-start;gap:8px;margin:7px 0}.content li[data-type=taskItem]>label{padding-top:3px}.content li[data-type=taskItem]>div{flex:1}.content li[data-type=taskItem] p{margin:0}.content li[data-checked=true]>div{opacity:.7;text-decoration:line-through}\(fontCSS())</style></head><body><article class="card"><div class="dots"><i class="dot red"></i><i class="dot yellow"></i><i class="dot green"></i></div><div class="title">\(title)</div><main class="content">\(content)</main></article></body></html>
        """
    }
    private static func escape(_ value: String) -> String { value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;") }
    private static func mediaPlaceholders(_ html: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: #"(?is)<(audio|video)\b([^>]*)>(.*?)</\1\s*>|<(audio|video)\b([^>]*)/?>"#) else { return html }
        let source = html as NSString
        var result = html
        for match in regex.matches(in: html, range: NSRange(location: 0, length: source.length)).reversed() {
            let attrsIndex = match.range(at: 2).location == NSNotFound ? 5 : 2
            let attrs = source.substring(with: match.range(at: attrsIndex))
            let src = attrs.matches(pattern: #"(?i)\bsrc\s*=\s*([\"'])(.*?)\1|\bsrc\s*=\s*([^\s>]+)"#).first
            let raw = src.flatMap { $0[2] ?? $0[3] }
            let filename = raw.flatMap { URL(string: $0)?.lastPathComponent } ?? "attached media"
            let placeholder = "<div class=\"media-placeholder\">Media attachment: \(Self.escape(filename))</div>"
            if let range = Range(match.range(at: 0), in: result) { result.replaceSubrange(range, with: placeholder) }
        }
        return result
    }
    private static func safeFilename(_ title: String) -> String {
        let cleaned = title.replacingOccurrences(of: "[^A-Za-z0-9 _-]", with: "", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        return String((cleaned.isEmpty ? "Foldnote" : cleaned).prefix(80))
    }
}

private extension String {
    func matches(pattern: String) -> [[String?]] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = self as NSString
        return regex.matches(in: self, range: NSRange(location: 0, length: ns.length)).map { result in
            (0..<result.numberOfRanges).map { idx in
                let range = result.range(at: idx)
                return range.location == NSNotFound ? nil : ns.substring(with: range)
            }
        }
    }
}
