import AppKit
import Foundation
@testable import BananaNotesCore

@main
struct BananaBrandAssetsSelfTest {
    static func main() throws {
        let root: URL
        if CommandLine.arguments.count == 2 {
            root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        } else if CommandLine.arguments.count == 1 {
            root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                .deletingLastPathComponent().deletingLastPathComponent()
        } else {
            fatalError("usage: BananaBrandAssetsSelfTest [REPOSITORY_ROOT]")
        }
        let notesDirectory = root.appendingPathComponent("assets/brand", isDirectory: true)
        let viewerDirectory = root.appendingPathComponent("assets/viewer-brand", isDirectory: true)
        let notes = try BananaBrandSVG.generatedFiles(repositoryRoot: root)
        let viewer = try BananaBrandSVG.generatedFiles(repositoryRoot: root, product: .viewer)
        let notesNames: Set<String> = [
            "app-icon.svg", "mark.svg", "mark-on-cocoa.svg", "logo.svg", "logo-dark.svg", "logo-on-cocoa.svg", "menu-bar.svg"
        ]
        let viewerNames: Set<String> = [
            "app-icon.svg", "mark.svg", "logo.svg", "logo-dark.svg", "logo-on-cocoa.svg"
        ]
        precondition(Set(notes.keys) == notesNames, "Notes must retain its existing generated SVG set")
        precondition(Set(viewer.keys) == viewerNames, "Viewer must generate its own bounded SVG set")

        for (name, expected) in notes {
            let actual = try Data(contentsOf: notesDirectory.appendingPathComponent(name))
            precondition(actual == Data(expected.utf8), "existing Notes SVG changed: \(name)")
        }
        for (name, expected) in viewer {
            let actual = try Data(contentsOf: viewerDirectory.appendingPathComponent(name))
            precondition(actual == Data(expected.utf8), "Viewer SVG drifted from the shared generator: \(name)")
        }

        let approvedLines = ##"<path d="M17.8 18.1H30M17.8 23.6H28M17.8 29.1H23.5" fill="none" stroke="#2E1D12" stroke-width="1.65" stroke-linecap="round"/>"##
        let mark = viewer["mark.svg"]!
        precondition(mark.contains("viewBox=\"5.5 7.25 33.5 33.5\""), "Viewer mark must preserve the approved mark viewBox")
        precondition(mark.contains("rotate(-8 23.5 24)"), "Viewer mark must preserve the approved rotation")
        precondition(mark.components(separatedBy: approvedLines).count == 2, "Viewer mark must contain exactly the approved three-line path")
        precondition(mark.contains("<title>Banana Viewer</title>") && !mark.contains("<rect"), "standalone Viewer mark must be titled and transparent")

        for name in ["logo.svg", "logo-dark.svg", "logo-on-cocoa.svg"] {
            let logo = viewer[name]!
            precondition(logo.contains("<title>Banana Viewer</title>"), "\(name) must name Banana Viewer")
            precondition(!logo.contains("<rect") && !logo.contains(BananaMark.Color.cocoa), "standalone Viewer logos must have transparent backgrounds")
            precondition(logo.components(separatedBy: approvedLines).count == 2, "\(name) must use the same Viewer mark")
        }
        let appIcon = viewer["app-icon.svg"]!
        precondition(appIcon.contains("fill=\"\(BananaMark.Color.cocoa)\""), "cocoa tile belongs on the Viewer app icon")
        precondition(appIcon.components(separatedBy: approvedLines).count == 2, "Viewer app icon must contain its writing lines")
        precondition(BananaMark.Product.notes.wordmarkSuffix == "notes" && BananaMark.Product.viewer.wordmarkSuffix == "viewer",
                     "each product must use its own lowercase wordmark suffix")
        precondition(wordmarkPathCount(notes["logo.svg"]!) == 11 && wordmarkPathCount(viewer["logo.svg"]!) == 12,
                     "generated wordmarks must outline banana plus the selected Space Mono suffix")
        try assertRasterWritingLinesRemainVisible()
        print("Brand checks passed (Notes output unchanged, approved Viewer mark and wordmark, transparent logos, legible icon)")
    }

    private static func wordmarkPathCount(_ svg: String) -> Int {
        guard let group = svg.range(of: "<g fill=\"#2A1D14\">") else {
            preconditionFailure("light-background wordmark must use the approved ink colour")
        }
        let wordmark = svg[group.lowerBound...]
        return wordmark.components(separatedBy: "<path").count - 1
    }

    @MainActor
    private static func assertRasterWritingLinesRemainVisible() throws {
        _ = NSApplication.shared
        for side in [32, 64] {
            let notes = renderIcon(side: side, product: .notes)
            let viewer = renderIcon(side: side, product: .viewer)
            let notesInk = darkPixelCount(notes)
            let viewerInk = darkPixelCount(viewer)
            precondition(viewerInk > notesInk, "Viewer writing lines must survive rasterization at \(side)px")
        }
    }

    @MainActor
    private static func renderIcon(side: Int, product: BananaMark.Product) -> NSBitmapImageRep {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side,
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                     isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        let context = NSGraphicsContext(bitmapImageRep: bitmap)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        BananaMarkRenderer.drawAppIcon(in: NSRect(x: 0, y: 0, width: side, height: side), product: product)
        NSGraphicsContext.restoreGraphicsState()
        return bitmap
    }

    private static func darkPixelCount(_ bitmap: NSBitmapImageRep) -> Int {
        var count = 0
        for y in 0..<bitmap.pixelsHigh {
            for x in 0..<bitmap.pixelsWide {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                if color.alphaComponent > 0.8 && color.redComponent < 0.35
                    && color.greenComponent < 0.25 && color.blueComponent < 0.2 {
                    count += 1
                }
            }
        }
        return count
    }
}
