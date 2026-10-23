import AppKit

final class NotePanel: NSPanel {
    var hideAction: (() -> Void)?
    // Borderless panels do not accept typing by default.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
    override func cancelOperation(_ sender: Any?) { hideAction?() }
}

/// WebKit consumes mouse-downs in the HTML header when its window is key.
/// Keep dragging native so the original NSEvent reaches AppKit synchronously.
final class TitlebarDragView: NSView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

final class WindowContentView: NSView {
    // The web layout reports only its empty spacer, never the controls. Keep
    // mouse-down/drag handling native, but do not guess fixed button widths.
    static let titlebarHeight: CGFloat = 36
    private let dragRegion = TitlebarDragView(frame: .zero)
    private let glassView = NSVisualEffectView(frame: .zero)
    var surfaceColor: NSColor = .windowBackgroundColor { didSet { needsDisplay = true } }

    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        effectiveAppearance.performAsCurrentDrawingAppearance {
            layer?.backgroundColor = surfaceColor.cgColor
        }
    }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }

    init(frame: NSRect, editor: NSView) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = 12
        layer?.masksToBounds = true
        glassView.frame = bounds
        glassView.autoresizingMask = [.width, .height]
        glassView.material = .underWindowBackground
        glassView.blendingMode = .behindWindow
        glassView.state = .active
        glassView.isHidden = true
        glassView.alphaValue = 0
        addSubview(glassView)
        editor.frame = bounds
        editor.autoresizingMask = [.width, .height]
        addSubview(editor)

        dragRegion.setAccessibilityElement(false)
        addSubview(dragRegion)
    }

    func setGlassAmount(_ amount: Double) {
        let value = amount.isFinite ? min(1, max(0, amount)) : 0
        glassView.alphaValue = value
        glassView.isHidden = value == 0
    }

    /// Input is a CSS-pixel rectangle with a top-left origin (WebKit's default
    /// page zoom maps those pixels to native points). Clamp to the control strip.
    @discardableResult
    func updateDragRegion(_ rect: NSRect) -> Bool {
        guard [rect.minX, rect.minY, rect.width, rect.height, rect.maxX, rect.maxY].allSatisfy({ $0.isFinite && $0 >= 0 }),
              rect.maxY <= Self.titlebarHeight else { return false }
        let strip = NSRect(x: 0, y: 0, width: bounds.width, height: min(Self.titlebarHeight, bounds.height))
        let clipped = rect.intersection(strip)
        dragRegion.frame = clipped.isNull || clipped.isEmpty ? .zero : NSRect(
            x: clipped.minX, y: bounds.height - clipped.maxY, width: clipped.width, height: clipped.height)
        return true
    }

    override func resizeSubviews(withOldSize oldSize: NSSize) {
        super.resizeSubviews(withOldSize: oldSize)
        // A stale rectangle must never cover controls while WebKit is resizing.
        if oldSize != bounds.size { dragRegion.frame = .zero }
    }

    required init?(coder: NSCoder) { nil }
}
