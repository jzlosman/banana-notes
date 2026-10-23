import AppKit

@main
struct MakeIcon {
    @MainActor
    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            fatalError("usage: make-icon.swift OUTPUT.png")
        }
        let image = NSImage(size: NSSize(width: BananaMark.iconCanvasSize, height: BananaMark.iconCanvasSize))
        image.lockFocus()
        BananaMarkRenderer.drawAppIcon(in: NSRect(origin: .zero, size: image.size))
        image.unlockFocus()
        guard let representation = NSBitmapImageRep(data: image.tiffRepresentation!)?.representation(using: .png, properties: [:]) else {
            fatalError("unable to encode app icon")
        }
        try representation.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
    }
}
