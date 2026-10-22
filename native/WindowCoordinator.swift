import AppKit
import QuartzCore
import WebKit

@MainActor
final class WindowCoordinator: NSObject, NSWindowDelegate {
    private(set) weak var panel: NotePanel?
    private weak var webView: WKWebView?
    private let stylePreferences: WindowStylePreferences
    private let preferences: any PreferencesStore
    private var channel: WebCommandChannel?
    private var focusState = WindowFocusState()
    private var focusLossTimer: Timer?
    private var motion = PanelMotionStateMachine()
    private var visibleFrame: NSRect?
    private var pinned: Bool
    private var presentingNativeUI = false
    var onError: ((String) -> Void)?

    init(stylePreferences: WindowStylePreferences, preferences: any PreferencesStore = UserDefaults.standard) {
        self.stylePreferences = stylePreferences
        self.preferences = preferences
        pinned = preferences.bool(forKey: "pinned")
        super.init()
    }

    var nativeWindow: NSWindow? { panel }
    var isFocused: Bool { focusState.isFocused }
    var isPinned: Bool { pinned }
    var isPresentingNativeUI: Bool { presentingNativeUI }
    var style: WindowStyle { stylePreferences.style }

    func attach(panel: NotePanel, webView: WKWebView) {
        self.panel = panel
        self.webView = webView
        panel.delegate = self
        applyWindowStyle()
    }

    func attach(channel: WebCommandChannel) { self.channel = channel }

    func show() {
        guard let panel, let webView else { return }
        if !panel.isVisible || motion.phase == .dismissing { summon(panel) }
        else { panel.orderFrontRegardless() }
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        webView.window?.makeFirstResponder(webView)
        updateFocus()
    }

    func toggle() {
        guard let panel else { return }
        panel.isVisible ? hideAfterFlush() : show()
    }

    func hideAfterFlush(onlyIfUnfocused: Bool = false) {
        guard let channel else { panel?.orderOut(nil); return }
        channel.flush { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                if onlyIfUnfocused && (self.focusState.isFocused || self.panel?.isKeyWindow == true || self.pinned || self.presentingNativeUI) { return }
                self.dismiss()
            case .failure(let error):
                self.show()
                self.onError?("Banana Notes stayed open because the latest changes could not be saved. " + error.localizedDescription)
            }
        }
    }

    func setPinned(_ value: Bool) {
        pinned = value
        preferences.set(value, forKey: "pinned")
        panel?.hidesOnDeactivate = false
    }

    func setPresentingNativeUI(_ value: Bool) { presentingNativeUI = value }

    func apply(theme: CatalogTheme?) {
        guard let panel else { return }
        guard let theme else {
            panel.appearance = nil
            (panel.contentView as? WindowContentView)?.surfaceColor = .windowBackgroundColor
            return
        }
        panel.appearance = NSAppearance(named: theme.appearance == .dark ? .darkAqua : .aqua)
        guard let value = UInt32(theme.colors.paper.dropFirst(), radix: 16) else { return }
        (panel.contentView as? WindowContentView)?.surfaceColor = NSColor(
            calibratedRed: CGFloat((value >> 16) & 255) / 255,
            green: CGFloat((value >> 8) & 255) / 255,
            blue: CGFloat(value & 255) / 255, alpha: 1)
    }

    func applyWindowStyle(animated: Bool = false) {
        guard let panel else { return }
        let opacity = stylePreferences.style.opacity(isFocused: focusState.isFocused)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = animated && panel.isVisible && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0.2 : 0
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().alphaValue = opacity
        }
        (panel.contentView as? WindowContentView)?.setGlassAmount(stylePreferences.style.glass)
    }

    func publishFocus() {
        applyWindowStyle(animated: true)
        channel?.send(.focus(focusState.isFocused))
    }

    @objc func updateFocus() {
        guard let panel else { return }
        focusLossTimer?.invalidate()
        focusLossTimer = nil
        let now = ProcessInfo.processInfo.systemUptime
        if focusState.update(isKeyWindow: panel.isKeyWindow, at: now) {
            publishFocus()
            if !focusState.isFocused && !pinned && !presentingNativeUI && panel.isVisible {
                hideAfterFlush(onlyIfUnfocused: true)
            }
        }
        if let deadline = focusState.lossDeadline {
            let timer = Timer(timeInterval: max(0, deadline - now), target: self,
                              selector: #selector(updateFocus), userInfo: nil, repeats: false)
            focusLossTimer = timer
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { hideAfterFlush(); return false }
    func windowDidBecomeKey(_ notification: Notification) { updateFocus() }
    func windowDidResignKey(_ notification: Notification) { updateFocus() }
    func windowDidResize(_ notification: Notification) { if motion.phase == .visible { visibleFrame = panel?.frame } }
    func windowDidMove(_ notification: Notification) { if motion.phase == .visible { visibleFrame = panel?.frame } }

    func shutdown() { focusLossTimer?.invalidate(); focusLossTimer = nil }

    private func summon(_ panel: NotePanel) {
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let target = visibleFrame ?? panel.frame
        visibleFrame = target
        switch motion.summon(reduceMotion: reduceMotion) {
        case .none: panel.orderFrontRegardless()
        case .showImmediately(let token):
            _ = motion.complete(token: token)
            panel.setFrame(target, display: false)
            panel.alphaValue = 1
            panel.orderFrontRegardless()
        case .summon(let token, let duration):
            let start = Self.nsRect(PanelMotionGeometry.summonStart(for: Self.motionFrame(target)))
            panel.setFrame(start, display: false)
            panel.alphaValue = 0
            panel.orderFrontRegardless()
            NSAnimationContext.runAnimationGroup { context in
                context.duration = duration
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                panel.animator().setFrame(target, display: true)
                panel.animator().alphaValue = 1
            } completionHandler: { [weak self, weak panel] in
                Task { @MainActor in
                    guard let self, let panel, self.motion.complete(token: token) else { return }
                    panel.setFrame(target, display: true)
                }
            }
        case .dismiss, .hideImmediately: break
        }
    }

    private func dismiss() {
        guard let panel else { return }
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let target = visibleFrame ?? panel.frame
        visibleFrame = target
        switch motion.dismiss(reduceMotion: reduceMotion) {
        case .none: return
        case .hideImmediately(let token):
            _ = motion.complete(token: token)
            panel.alphaValue = 1
            panel.setFrame(target, display: false)
            panel.orderOut(nil)
        case .dismiss(let token, let duration):
            let end = Self.nsRect(PanelMotionGeometry.dismissEnd(from: Self.motionFrame(target)))
            NSAnimationContext.runAnimationGroup { context in
                context.duration = duration
                context.timingFunction = CAMediaTimingFunction(name: .easeIn)
                panel.animator().setFrame(end, display: true)
                panel.animator().alphaValue = 0
            } completionHandler: { [weak self, weak panel] in
                Task { @MainActor in
                    guard let self, let panel, self.motion.complete(token: token) else { return }
                    panel.orderOut(nil)
                    panel.setFrame(target, display: false)
                    panel.alphaValue = 1
                }
            }
        case .summon, .showImmediately: break
        }
    }

    private static func motionFrame(_ rect: NSRect) -> PanelMotionFrame {
        PanelMotionFrame(x: Double(rect.origin.x), y: Double(rect.origin.y), width: Double(rect.width), height: Double(rect.height))
    }

    private static func nsRect(_ frame: PanelMotionFrame) -> NSRect {
        NSRect(x: CGFloat(frame.x), y: CGFloat(frame.y), width: CGFloat(frame.width), height: CGFloat(frame.height))
    }
}
