import Foundation
@testable import BananaNotesCore

@main
struct BananaMarkSelfTest {
    static func main() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let brandDirectory = root.appendingPathComponent("assets/brand", isDirectory: true)
        let generated = try BananaBrandSVG.generatedFiles(repositoryRoot: root)
        precondition(Set(generated.keys) == Set([
            "app-icon.svg", "mark.svg", "mark-on-cocoa.svg", "logo.svg", "logo-dark.svg", "logo-on-cocoa.svg", "menu-bar.svg"
        ]), "the brand generator owns the complete committed SVG set")
        for (name, expected) in generated {
            let file = brandDirectory.appendingPathComponent(name)
            let actual = try String(contentsOf: file, encoding: .utf8)
            precondition(actual == expected, "\(file.lastPathComponent) drifted from BananaMark geometry or the bundled Space Mono outlines")
            precondition(actual.contains("role=\"img\"") && actual.contains("<title>Banana Notes</title>"),
                         "\(file.lastPathComponent) must expose an accessible image title")
        }
        precondition(BananaMark.Color.banana == "#FBE122" && BananaMark.Color.peel == "#D9A00A"
            && BananaMark.Color.espresso == "#2E1D12" && BananaMark.Color.cocoa == "#5A3A22",
            "the pure brand palette must match the approved colours")
        print("Banana brand checks passed (all committed SVGs match generated geometry and Space Mono outlines)")
    }
}
