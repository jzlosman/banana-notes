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
    private let reduceMotionSource: () -> Bool
    private let focusSource: (() -> Bool)?
    private var pinned: Bool
    private var presentingNativeUI = false
    var onPinnedChange: ((Bool) -> Void)?
    var onError: ((String) -> Void)?

    init(stylePreferences: WindowStylePreferences, preferences: any PreferencesStore = UserDefaults.standard,
         reduceMotionSource: (() -> Bool)? = nil, focusSource: (() -> Bool)? = nil) {
        self.stylePreferences = stylePreferences
        self.preferences = preferences
        self.reduceMotionSource = reduceMotionSource ?? { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
        self.focusSource = focusSource
        pinned = WindowPreferencePolicy.pinned(from: preferences.object(forKey: "pinned"))
        super.init()
    }

    var nativeWindow: NSWindow? { panel }
    var isFocused: Bool { focusState.isFocused }
    var isPinned: Bool { pinned }
    var isPresentingNativeUI: Bool { presentingNativeUI }
    var style: WindowStyle { stylePreferences.style }
    private var presentedFocus: Bool { focusSource?() ?? focusState.isFocused }
    private var motionOwnsAlpha: Bool { motion.phase == .summoning || motion.phase == .dismissing }

    func attach(panel: NotePanel, webView: WKWebView) {
        self.panel = panel
        self.webView = webView
        panel.delegate = self
        applyWindowStyle()
    }

    func attach(channel: WebCommandChannel) { self.channel = channel }

    func show() {
        guard let panel, let webView else { return }
        NSApp.activate(ignoringOtherApps: true)
        if !panel.isVisible || motion.phase == .dismissing { summon() }
        else { panel.orderFrontRegardless(); panel.makeKeyAndOrderFront(nil) }
        webView.window?.makeFirstResponder(webView)
        updateFocus()
    }

    func toggle() {
        guard let panel else { return }
        panel.isVisible ? hideAfterFlush() : show()
    }

    func hideAfterFlush(onlyIfUnfocused: Bool = false) {
        guard let channel else { dismiss(); return }
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
        onPinnedChange?(value)
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
        if !motionOwnsAlpha {
            let opacity = stylePreferences.style.opacity(isFocused: presentedFocus)
            NSAnimationContext.runAnimationGroup { context in
                context.duration = animated && panel.isVisible && !reduceMotionSource() ? 0.2 : 0
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                panel.animator().alphaValue = opacity
            }
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

    func summon() {
        guard let panel else { return }
        let target = visibleFrame ?? panel.frame
        visibleFrame = target
        switch motion.summon(reduceMotion: reduceMotionSource()) {
        case .none:
            panel.orderFrontRegardless()
        case .summon(let token, let duration, let moves):
            let start = moves ? Self.nsRect(PanelMotionGeometry.summonStart(for: Self.motionFrame(target))) : target
            panel.setFrame(start, display: false)
            panel.alphaValue = 0
            panel.makeKeyAndOrderFront(nil)
            updateFocus()
            let opacity = stylePreferences.style.opacity(isFocused: presentedFocus)
            NSAnimationContext.runAnimationGroup { context in
                context.duration = duration
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1)
                if moves { panel.animator().setFrame(target, display: true) }
                panel.animator().alphaValue = opacity
            } completionHandler: { [weak self, weak panel] in
                Task { @MainActor in
                    guard let self, let panel, self.motion.complete(token: token) else { return }
                    panel.setFrame(target, display: true)
                    self.applyWindowStyle()
                }
            }
        case .dismiss: break
        }
    }

    func dismiss() {
        guard let panel else { return }
        let target = visibleFrame ?? panel.frame
        visibleFrame = target
        switch motion.dismiss(reduceMotion: reduceMotionSource()) {
        case .none: return
        case .dismiss(let token, let duration, let moves):
            // Reset an interrupted summon to the saved visible frame before the
            // new transition so an obsolete animator cannot leave a stale frame.
            panel.setFrame(target, display: false)
            let end = moves ? Self.nsRect(PanelMotionGeometry.dismissEnd(from: Self.motionFrame(target))) : target
            NSAnimationContext.runAnimationGroup { context in
                context.duration = duration
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.4, 0, 1, 1)
                if moves { panel.animator().setFrame(end, display: true) }
                panel.animator().alphaValue = 0
            } completionHandler: { [weak self, weak panel] in
                Task { @MainActor in
                    guard let self, let panel, self.motion.complete(token: token) else { return }
                    panel.orderOut(nil)
                    panel.setFrame(target, display: false)
                    panel.alphaValue = self.stylePreferences.style.opacity(isFocused: self.presentedFocus)
                    self.applyWindowStyle()
                }
            }
        case .summon: break
        }
    }

    private static func motionFrame(_ rect: NSRect) -> PanelMotionFrame {
        PanelMotionFrame(x: Double(rect.origin.x), y: Double(rect.origin.y), width: Double(rect.width), height: Double(rect.height))
    }

    private static func nsRect(_ frame: PanelMotionFrame) -> NSRect {
        NSRect(x: CGFloat(frame.x), y: CGFloat(frame.y), width: CGFloat(frame.width), height: CGFloat(frame.height))
    }
}
