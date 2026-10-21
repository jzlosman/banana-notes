import AppKit

@main
struct MakeIcon {
    @MainActor
    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            fatalError("usage: make-icon.swift OUTPUT.png")
        }
        let image = NSImage(size: NSSize(width: 1024, height: 1024))
        image.lockFocus()
        NSColor(calibratedRed: 0xF4 / 255, green: 0xD4 / 255, blue: 0x47 / 255, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: 1024, height: 1024).insetBy(dx: 96, dy: 96), xRadius: 185, yRadius: 185).fill()
        BananaMark.draw(in: NSRect(x: 96, y: 96, width: 832, height: 832), color: NSColor(calibratedRed: 0x27 / 255, green: 0x25 / 255, blue: 0x1E / 255, alpha: 1))
        image.unlockFocus()
        guard let representation = NSBitmapImageRep(data: image.tiffRepresentation!)?.representation(using: .png, properties: [:]) else {
            fatalError("unable to encode app icon")
        }
        try representation.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
    }
}
