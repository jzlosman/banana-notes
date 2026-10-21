import Foundation

/// Translates public URL aliases into editor commands without changing stored note URLs.
enum AppDeepLink {
    static func command(for url: URL) -> [String: String]? {
        guard let scheme = url.scheme?.lowercased(), ["banananotes", "foldnote"].contains(scheme) else { return nil }
        let action = url.host?.lowercased() ?? url.path.split(separator: "/").first.map(String.init)?.lowercased() ?? "show"
        switch action {
        case "new", "explorer", "themes": return ["action": action]
        case "tag":
            let components = url.path.split(separator: "/")
            let tag = (url.host == nil ? components.dropFirst() : components[...]).joined(separator: "/")
            return ["action": "tag", "tag": tag]
        default: return ["action": "show"]
        }
    }
}
