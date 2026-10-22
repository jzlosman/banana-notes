import Foundation

enum WebNavigationKind { case bundledLoad, linkActivated, programmatic, newWindow }
enum WebNavigationDecision: Equatable {
    case allowBundled
    case openExternal(URL)
    case cancel
}

/// Pure URL policy for the WebKit adapter. External links are never rendered in-app.
enum WebNavigationPolicy {
    static func decide(url: URL?, sourceURL: URL?, kind: WebNavigationKind, bundledRoot: URL) -> WebNavigationDecision {
        guard let url else { return .cancel }
        let sourceIsBundled = sourceURL.map { isInsideBundledDirectory($0, root: bundledRoot) } ?? (kind == .bundledLoad)
        if (kind == .bundledLoad || kind == .programmatic) && isInsideBundledDirectory(url, root: bundledRoot) {
            return .allowBundled
        }
        guard sourceIsBundled, (kind == .linkActivated || kind == .newWindow),
              isAllowedExternalURL(url) else { return .cancel }
        return .openExternal(url)
    }

    static func isInsideBundledDirectory(_ url: URL, root: URL) -> Bool {
        guard url.isFileURL else { return false }
        let rootPath = root.resolvingSymlinksInPath().standardizedFileURL.path
        let path = url.resolvingSymlinksInPath().standardizedFileURL.path
        return path == rootPath || path.hasPrefix(rootPath.hasSuffix("/") ? rootPath : rootPath + "/")
    }

    static func isAllowedExternalURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        switch scheme {
        case "http", "https":
            guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  let host = components.host, !host.isEmpty else { return false }
            return components.user == nil && components.password == nil
        case "mailto":
            return !url.path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        default: return false
        }
    }
}
