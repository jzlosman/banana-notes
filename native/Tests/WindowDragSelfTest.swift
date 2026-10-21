import AppKit

private final class RecordingWindow: NSWindow {
    var simulatedKeyWindow = false
    var dragEvents: [NSEvent] = []
    override var isKeyWindow: Bool { simulatedKeyWindow }
    override func performDrag(with event: NSEvent) { dragEvents.append(event) }
}

@main
struct WindowDragSelfTest {
    @MainActor
    static func main() {
        _ = NSApplication.shared
        let window = RecordingWindow(contentRect: NSRect(x: 0, y: 0, width: 540, height: 650),
                                     styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
        let borderless = FoldnotePanel(contentRect: NSRect(x: 0, y: 0, width: 540, height: 650),
                                     styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
        precondition(borderless.canBecomeKey && borderless.canBecomeMain, "borderless notes must accept typing and shortcuts")
        precondition(!borderless.styleMask.contains(.titled) && borderless.styleMask.contains(.resizable))
        for type: NSWindow.ButtonType in [.closeButton, .miniaturizeButton, .zoomButton] {
            precondition(borderless.standardWindowButton(type) == nil, "native traffic lights must not exist")
        }
        var hidden = false
        borderless.hideAction = { hidden = true }
        borderless.cancelOperation(nil)
        precondition(hidden, "Escape must still use the hide action")
        let editor = NSView()
        let content = WindowContentView(frame: window.contentView!.bounds, editor: editor)
        window.contentView = content
        let dragRegion = content.subviews.compactMap { $0 as? TitlebarDragView }.first!
        precondition(content.layer?.cornerRadius == 12 && content.layer?.masksToBounds == true,
                     "borderless content must retain rounded corners")
        let event = NSEvent.mouseEvent(with: .leftMouseDown, location: NSPoint(x: 240, y: 620),
                                       modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber,
                                       context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!

        for focused in [false, true] {
            window.simulatedKeyWindow = focused
            precondition(dragRegion.acceptsFirstMouse(for: event), "background drag must accept the initial click")
            let count = window.dragEvents.count
            dragRegion.mouseDown(with: event)
            precondition(window.dragEvents.count == count + 1, "drag must reach AppKit regardless of focus")
            precondition(window.dragEvents.last === event, "must use the original mouse event, not an asynchronous bridge")
        }

        for size in [NSSize(width: 540, height: 650), NSSize(width: 380, height: 400), NSSize(width: 760, height: 800)] {
            content.setFrameSize(size)
            precondition(content.updateDragRegion(NSRect(x: 110, y: 0, width: size.width - 260, height: 36)))
            precondition(content.hitTest(NSPoint(x: 120, y: size.height - 30)) === dragRegion,
                         "header must route to native dragging after resize")
            for x in [size.width - 122, size.width - 90, size.width - 58, size.width - 26] {
                precondition(content.hitTest(NSPoint(x: x, y: size.height - 22)) === editor,
                             "pin, explorer, new-note and source buttons must remain interactive")
            }
            precondition(content.hitTest(NSPoint(x: 20, y: size.height - 20)) === editor,
                         "notebook and tag controls on the left must remain interactive")
            precondition(content.hitTest(NSPoint(x: 120, y: size.height - 90)) === editor,
                         "note text selection must not drag the window")
        }
        content.setFrameSize(NSSize(width: 500, height: 650))
        precondition(content.hitTest(NSPoint(x: 120, y: 630)) === editor,
                     "resize must invalidate stale drag regions until WebKit reports the new gap")
        precondition(!content.updateDragRegion(NSRect(x: 0, y: 0, width: 200, height: 37)))
        precondition(!content.updateDragRegion(NSRect(x: -1, y: 0, width: 200, height: 36)))
        precondition(!content.updateDragRegion(NSRect(x: CGFloat.nan, y: 0, width: 200, height: 36)))
        precondition(content.updateDragRegion(.zero))
        print("Native window drag checks passed (focus, dynamic toolbar gap, controls, resize and invalid geometry)")
    }
}
