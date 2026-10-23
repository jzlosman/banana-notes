import AppKit
@testable import BananaNotesCore
import WebKit

@main
struct PanelMotionIntegrationSelfTest {
    @MainActor
    static func main() throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)

        let suiteName = "com.jzlosman.banana-notes.panel-motion-test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let style = WindowStylePreferences(defaults: defaults)
        try style.save(WindowStyle(focusedOpacity: 0.9, unfocusedOpacity: 0.4, glass: 0))

        var focused = true
        var reduceMotion = false
        let coordinator = WindowCoordinator(stylePreferences: style, preferences: defaults,
                                            reduceMotionSource: { reduceMotion }, focusSource: { focused })
        let target = NSRect(x: -20_000, y: -20_000, width: 540, height: 650)
        let panel = NotePanel(contentRect: target, styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.hidesOnDeactivate = false
        let webView = WKWebView(frame: .zero)
        coordinator.attach(panel: panel, webView: webView)
        let channel = WebCommandChannel(send: { _ in }, flush: { completion in completion(.success(())) })
        channel.markReady()
        coordinator.attach(channel: channel)
        defer {
            coordinator.shutdown()
            panel.orderOut(nil)
            panel.delegate = nil
        }

        coordinator.show()
        precondition(panel.isVisible, "summon should order the panel front immediately")
        runLoop(for: 0.24)
        precondition(panel.frame == target, "summon should finish at its saved frame")
        precondition(abs(panel.alphaValue - 0.9) < 0.01, "summon should honor focused opacity")

        coordinator.hideAfterFlush()
        runLoop(for: 0.025)
        focused = false
        coordinator.publishFocus()
        runLoop(for: 0.18)
        precondition(!panel.isVisible, "dismiss should order out even when focus changes mid-animation")
        precondition(panel.frame == target, "dismiss should restore the saved visible frame")
        precondition(abs(panel.alphaValue - 0.4) < 0.01, "dismiss should restore current unfocused style opacity")

        focused = true
        coordinator.show()
        runLoop(for: 0.025)
        coordinator.dismiss()
        runLoop(for: 0.025)
        coordinator.show()
        runLoop(for: 0.24)
        precondition(panel.isVisible && panel.frame == target, "rapid summon/dismiss/summon should end visible at target")
        precondition(abs(panel.alphaValue - 0.9) < 0.01, "the last summon should restore focused style opacity")

        reduceMotion = true
        coordinator.dismiss()
        precondition(panel.isVisible && panel.frame == target, "Reduce Motion dismissal should fade without moving")
        runLoop(for: 0.13)
        precondition(!panel.isVisible && panel.frame == target, "Reduce Motion dismissal should order out after its fade")

        coordinator.show()
        precondition(panel.isVisible && panel.frame == target, "Reduce Motion summon should not move the panel")
        runLoop(for: 0.14)
        precondition(panel.isVisible && panel.frame == target && abs(panel.alphaValue - 0.9) < 0.01,
                     "Reduce Motion summon should fade to focused opacity")

        coordinator.dismiss()
        precondition(panel.isVisible && panel.frame == target, "Reduce Motion dismissal should fade without moving")
        runLoop(for: 0.13)
        precondition(!panel.isVisible && panel.frame == target && abs(panel.alphaValue - 0.9) < 0.01,
                     "Reduce Motion dismissal should order out and restore frame and opacity")
        print("Panel motion AppKit integration checks passed (focus changes, interruptions, style opacity, Reduce Motion)")
    }

    @MainActor
    private static func runLoop(for duration: TimeInterval) {
        RunLoop.main.run(until: Date(timeIntervalSinceNow: duration))
    }
}
