import AppKit

@main
struct WindowStyleSelfTest {
    @MainActor
    static func main() throws {
        _ = NSApplication.shared
        let suite = "FoldnoteWindowStyle-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let prefs = WindowStylePreferences(defaults: defaults)
        precondition(prefs.style == .solid)
        try prefs.save(WindowStyle(focusedOpacity: 0.8, unfocusedOpacity: 0.15, glass: 0.7))
        let reloaded = WindowStylePreferences(defaults: defaults)
        precondition(reloaded.style == prefs.style)
        precondition(reloaded.style.opacity(isFocused: true) == 0.8)
        precondition(reloaded.style.opacity(isFocused: false) == 0.15)
        for invalid in [
            WindowStyle(focusedOpacity: 0, unfocusedOpacity: 1, glass: 0),
            WindowStyle(focusedOpacity: 1, unfocusedOpacity: 1, glass: .nan),
            WindowStyle(focusedOpacity: 1, unfocusedOpacity: 1, glass: 1.1)
        ] {
            do { try prefs.save(invalid); preconditionFailure("invalid effects accepted") }
            catch is StoreError {}
        }
        precondition(prefs.style == reloaded.style, "rejected values must not replace saved choices")
        try prefs.reset()
        precondition(prefs.style == .solid)
        defaults.set(Data("bad json".utf8), forKey: "windowStyle")
        precondition(WindowStylePreferences(defaults: defaults).style == .solid)

        let content = WindowContentView(frame: NSRect(x: 0, y: 0, width: 540, height: 650), editor: NSView())
        let effect = content.subviews.compactMap { $0 as? NSVisualEffectView }.first!
        precondition(effect.isHidden && effect.alphaValue == 0, "solid defaults must skip backdrop compositing")
        content.setGlassAmount(0.7)
        precondition(!effect.isHidden && abs(effect.alphaValue - 0.7) < 0.001)
        precondition(effect.blendingMode == .behindWindow && effect.material == .underWindowBackground)
        precondition(effect.state == .active, "pinned inactive notes must retain their glass")
        content.setGlassAmount(0)
        precondition(effect.isHidden)
        print("Native window effects checks passed (validation, independent focus opacity, persistence, reset, real backdrop)")
    }
}
