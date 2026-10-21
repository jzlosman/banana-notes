import Foundation

@main
struct AppDeepLinkSelfTest {
    static func main() {
        for scheme in ["banananotes", "foldnote", "BANANANOTES", "FOLDNOTE"] {
            for action in ["show", "new", "explorer", "themes"] {
                precondition(AppDeepLink.command(for: URL(string: "\(scheme)://\(action)")!) == ["action": action])
            }
            precondition(AppDeepLink.command(for: URL(string: "\(scheme)://tag/work/project")!) == ["action": "tag", "tag": "work/project"])
            precondition(AppDeepLink.command(for: URL(string: "\(scheme):/tag/work/project")!) == ["action": "tag", "tag": "work/project"])
            precondition(AppDeepLink.command(for: URL(string: "\(scheme)://unknown")!) == ["action": "show"])
        }
        for value in ["https://new", "file:///tag/work", "foldnote-asset://media/photo.png", "foldnote-font://cache/font.woff2"] {
            precondition(AppDeepLink.command(for: URL(string: value)!) == nil, "only app links may become editor commands")
        }
        print("Native deep-link checks passed (Banana Notes and legacy aliases)")
    }
}
