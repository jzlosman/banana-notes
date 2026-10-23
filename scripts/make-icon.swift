import AppKit

@main
struct MakeIcon {
    @MainActor
    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            fatalError("usage: make-icon.swift OUTPUT.png")
        }
        let side = Int(BananaMark.iconCanvasSize)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            fatalError("unable to create an sRGB icon canvas")
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        BananaMarkRenderer.drawAppIcon(in: NSRect(x: 0, y: 0, width: side, height: side))
        NSGraphicsContext.restoreGraphicsState()
        guard let cgImage = context.makeImage(),
              let representation = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) else {
            fatalError("unable to encode app icon")
        }
        try representation.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
    }
}
