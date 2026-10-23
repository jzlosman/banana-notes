import Foundation
@testable import BananaNotesCore

@main struct BananaMarkSelfTest {
    static func main() throws {
        let asset = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("assets/banana-notes-logo.svg")
        let svg = try String(contentsOf: asset, encoding: .utf8)
        let regex = try NSRegularExpression(pattern: #"<path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})"/>"#)
        let ns = svg as NSString
        let assetPaths = regex.matches(in: svg, range: NSRange(location: 0, length: ns.length))
            .map { (ns.substring(with: $0.range(at: 1)), ns.substring(with: $0.range(at: 2))) }
        precondition(assetPaths.count == BananaMark.logoPaths.count
            && zip(assetPaths, BananaMark.logoPaths).allSatisfy { $0.0 == $1.d && $0.1 == $1.fill },
            "BananaMark.logoPaths must match assets/banana-notes-logo.svg")
        precondition(BananaMark.logoSVG(side: 18).contains("width=\"18.0\""))
        print("Banana logo checks passed (export logo matches the approved asset)")
    }
}
