import AppKit
import Vision

@main struct OCRSelfTest {
    @MainActor static func main() async throws {
        _ = NSApplication.shared
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("FoldnoteOCR-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let image = NSImage(size: NSSize(width: 900, height: 180))
        image.lockFocus()
        NSColor.white.setFill(); NSRect(x: 0, y: 0, width: 900, height: 180).fill()
        ("Foldnote local OCR" as NSString).draw(at: NSPoint(x: 30, y: 55), withAttributes: [.font: NSFont.systemFont(ofSize: 64), .foregroundColor: NSColor.black])
        image.unlockFocus()
        let data = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
        let url = directory.appendingPathComponent("fixture.png"); try data.write(to: url)
        let recognized = try await OCRService().recognize(url: url)
        precondition(recognized.lowercased().contains("foldnote") && recognized.lowercased().contains("local"), "local OCR must recognize the synthetic fixture")
        print("Native OCR checks passed (real Vision recognition on synthetic text image)")
    }
}
