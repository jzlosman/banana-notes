import AppKit
@testable import BananaNotesCore
import WebKit

@main struct NoteScrollbarSelfTest {
    @MainActor static func main() async throws {
        _ = NSApplication.shared
        let project = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let css = try String(contentsOf: project.appendingPathComponent("web/src/style.css"), encoding: .utf8)
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 400, height: 400))
        let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = view
        defer { window.close() }
        view.loadHTMLString("<html><head><style>\(css)</style></head><body><div class='editor-scroll quiet-scroll' style='height:120px;width:180px'><div style='height:2000px'>Synthetic note</div></div><textarea class='source-editor quiet-scroll' style='height:120px;width:180px'></textarea></body></html>", baseURL: nil)
        var loaded = false
        for _ in 0..<100 {
            try await Task.sleep(nanoseconds: 50_000_000)
            loaded = (try? await view.evaluateJavaScript("document.readyState==='complete' && !!document.querySelector('.source-editor')")) as? Bool == true
            if loaded { break }
        }
        precondition(loaded, "Scrollbar fixture must load")
        let script = #"""
        const root = document.documentElement;
        const source = document.querySelector('.source-editor'); source.value = 'Synthetic source line\n'.repeat(150);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        const alpha = color => { ctx.clearRect(0,0,1,1); ctx.fillStyle = color; ctx.fillRect(0,0,1,1); return ctx.getImageData(0,0,1,1).data[3]; };
        const results = [];
        for (const [theme, ink, paper] of [['light','#24282c','#ffffff'],['dark','#e8edef','#222629']]) {
          root.style.setProperty('--ink',ink); root.style.setProperty('--paper',paper);
          for (const focused of [true,false]) {
            root.dataset.focused = String(focused);
            for (const el of [document.querySelector('.editor-scroll'),source]) {
              el.style.scrollBehavior = 'auto'; el.scrollTop = 240;
              const color = getComputedStyle(el,'::-webkit-scrollbar-thumb').backgroundColor;
              results.push({theme,focused,kind:el.classList[0],alpha:alpha(color),highContrast:matchMedia('(prefers-contrast: more)').matches,scrollTop:el.scrollTop,width:el.clientWidth});
            }
          }
        }
        results;
        """#
        let results = try await view.evaluateJavaScript(script) as! [[String: Any]]
        precondition(results.count == 8)
        for result in results {
            let focused = result["focused"] as! Bool, alpha = result["alpha"] as! Int
            let limit = (result["highContrast"] as! Bool) ? 150 : 90
            precondition(focused ? alpha > 0 && alpha < limit : alpha == 0, "Focused thumbs must be subtle; unfocused thumbs must be transparent: \(result)")
            precondition((result["scrollTop"] as! Int) == 240, "Hidden scrollbars must not disable scrolling")
        }
        for theme in ["light", "dark"] {
            for kind in ["editor-scroll", "source-editor"] {
                let widths = results.filter { $0["theme"] as? String == theme && $0["kind"] as? String == kind }.map { $0["width"] as! Int }
                precondition(widths[0] == widths[1], "Focus changes must not shift the writing width")
            }
        }
        print("Native note scrollbar checks passed (light/dark, live/source, transparent on blur, scrolling and stable width)")
    }
}
