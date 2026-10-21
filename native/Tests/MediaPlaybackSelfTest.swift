import AppKit
import WebKit

@MainActor private final class MediaReady: NSObject, WKNavigationDelegate {
    var completed = false
    var error: Error?
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { completed = true }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { self.error = error; completed = true }
}

@main struct MediaPlaybackSelfTest {
    @MainActor static func main() async throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("FoldnotePlayback-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try AttachmentStore(directory: root)
        let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")
        let audio = try store.importURL(fixtures.appendingPathComponent("tone.mp3"))
        let video = try store.importURL(fixtures.appendingPathComponent("clip.mp4"))
        let config = WKWebViewConfiguration(); config.setURLSchemeHandler(MediaSchemeHandler(store: store), forURLScheme: "foldnote-asset")
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 400, height: 300), configuration: config)
        let window = NSWindow(contentRect: NSRect(x: -3000, y: -3000, width: 400, height: 300), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = view
        let ready = MediaReady(); view.navigationDelegate = ready
        view.loadHTMLString("<html><body><audio controls preload='metadata' src='\(audio.url)'></audio><video controls preload='metadata' src='\(video.url)'></video></body></html>", baseURL: nil)
        var states: [[String: Any]] = []
        for _ in 0..<150 {
            try await Task.sleep(nanoseconds: 100_000_000)
            if let error = ready.error { throw error }
            if ready.completed {
                states = try await view.evaluateJavaScript("Array.from(document.querySelectorAll('audio,video')).map(m=>({ready:m.readyState,duration:Number.isFinite(m.duration)?m.duration:0,error:m.error?.code||0}))") as? [[String: Any]] ?? []
                if states.count == 2 && states.allSatisfy({ ($0["ready"] as? Int ?? 0) >= 1 && ($0["duration"] as? Double ?? 0) > 0 }) { break }
            }
        }
        precondition(states.count == 2 && states.allSatisfy({ ($0["ready"] as? Int ?? 0) >= 1 && ($0["duration"] as? Double ?? 0) > 0 }), "managed MP3/MP4 must decode real metadata: \(states)")
        window.close()
        print("Native media playback checks passed (real MP3/MP4 metadata over managed scheme, no autoplay)")
    }
}
