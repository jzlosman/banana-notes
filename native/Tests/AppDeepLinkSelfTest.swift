import Foundation
@testable import BananaNotesCore

@main
struct AppDeepLinkSelfTest {
    static func main() {
        for scheme in ["banananotes", "foldnote", "BANANANOTES", "FOLDNOTE"] {
            let expected: [String: WebCommand] = ["show": .show, "new": .new, "explorer": .explorer, "themes": .themes]
            for (action, command) in expected {
                precondition(AppDeepLink.command(for: URL(string: "\(scheme)://\(action)")!) == command)
            }
            precondition(AppDeepLink.command(for: URL(string: "\(scheme)://tag/work/project")!) == .tag("work/project"))
            precondition(AppDeepLink.command(for: URL(string: "\(scheme):/tag/work/project")!) == .tag("work/project"))
            precondition(AppDeepLink.command(for: URL(string: "\(scheme)://unknown")!) == .show)
        }
        for value in ["https://new", "file:///tag/work", "foldnote-asset://media/photo.png", "foldnote-font://cache/font.woff2"] {
            precondition(AppDeepLink.command(for: URL(string: value)!) == nil, "only app links may become editor commands")
        }
        print("Native deep-link checks passed (Banana Notes and legacy aliases)")
    }
}
