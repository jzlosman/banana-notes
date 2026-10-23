import AppKit
@testable import BananaNotesCore

@main
struct WindowMenuSelfTest {
    @MainActor
    static func main() throws {
        _ = NSApplication.shared
        let suite = "FoldnoteWindowMenu-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let style = WindowStylePreferences(defaults: defaults)
        let window = WindowCoordinator(stylePreferences: style, preferences: defaults, reduceMotionSource: { false })
        var sent: [WebCommand] = []
        let channel = WebCommandChannel(send: { sent.append($0) }, flush: { $0(.success(())) })
        channel.markReady()
        let actions = MenuActionCoordinator(window: window, channel: channel, windowStyle: style,
                                            dataDirectory: FileManager.default.temporaryDirectory)
        let menu = NativeMenuBarController(hotkeyDisplay: "⌃⇧Space", hotkeyAvailable: true,
                                           isPinned: window.isPinned, onAction: { actions.handle($0) })
        window.onPinnedChange = { [weak menu] in menu?.updatePinned($0) }

        let windowMenu = NSApp.mainMenu?.items.first(where: { $0.title == "Window" })?.submenu
        guard let pin = windowMenu?.items.first(where: { $0.title == "Pin Window" }) else {
            preconditionFailure("Window menu must expose Pin Window")
        }
        precondition(pin.keyEquivalent == "p")
        precondition(pin.keyEquivalentModifierMask == [.command, .shift], "pin shortcut must be Command–Shift–P")
        precondition(pin.state == .on, "fresh default pin state must be checked")

        precondition(NSApp.sendAction(pin.action!, to: pin.target, from: pin), "the menu item must dispatch its pin action")
        precondition(!window.isPinned && pin.state == .off, "the menu action toggles the authoritative pin state and its checkmark")
        precondition(sent == [.pin(false)], "the toolbar receives the same native pin state")

        let bridge = WindowBridgeHandler(window: window, channel: channel, windowStyle: style,
                                         fontSize: FontSizePreferences(defaults: defaults))
        var reply: Any?
        try bridge.handle(.pin(true)) { body, _ in reply = body }
        precondition(window.isPinned && pin.state == .on, "toolbar pin changes update the native menu checkmark")
        precondition((reply as? [String: Any])?["pinned"] as? Bool == true)
        print("Native pin menu checks passed (Command–Shift–P, menu and bridge state synchronization)")
    }
}
