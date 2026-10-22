import Foundation

@main
struct WebNavigationPolicySelfTest {
    static func main() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("NavigationPolicy-\(UUID().uuidString)", isDirectory: true)
        let web = base.appendingPathComponent("web", isDirectory: true)
        let outside = base.appendingPathComponent("outside", isDirectory: true)
        try FileManager.default.createDirectory(at: web, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }
        let index = web.appendingPathComponent("index.html")
        try Data("bundled".utf8).write(to: index)
        let page = web.appendingPathComponent("settings/index.html")
        try FileManager.default.createDirectory(at: page.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("bundled".utf8).write(to: page)
        let outsidePage = outside.appendingPathComponent("index.html")
        try Data("outside".utf8).write(to: outsidePage)
        let linked = web.appendingPathComponent("linked.html")
        try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: outsidePage)

        precondition(WebNavigationPolicy.decide(url: index, sourceURL: nil, kind: .bundledLoad, bundledRoot: web) == .allowBundled)
        precondition(WebNavigationPolicy.decide(url: page, sourceURL: index, kind: .programmatic, bundledRoot: web) == .allowBundled)
        precondition(WebNavigationPolicy.decide(url: linked, sourceURL: index, kind: .programmatic, bundledRoot: web) == .cancel,
                     "a symlink must not escape the bundled web root")
        let https = URL(string: "https://example.com/docs")!
        precondition(WebNavigationPolicy.decide(url: https, sourceURL: index, kind: .linkActivated, bundledRoot: web) == .openExternal(https))
        precondition(WebNavigationPolicy.decide(url: https, sourceURL: outsidePage, kind: .linkActivated, bundledRoot: web) == .cancel)
        precondition(WebNavigationPolicy.decide(url: https, sourceURL: index, kind: .newWindow, bundledRoot: web) == .openExternal(https))
        precondition(WebNavigationPolicy.decide(url: https, sourceURL: index, kind: .programmatic, bundledRoot: web) == .cancel)
        precondition(WebNavigationPolicy.decide(url: URL(string: "mailto:notes@example.com")!, sourceURL: index, kind: .linkActivated, bundledRoot: web) != .cancel)
        precondition(WebNavigationPolicy.decide(url: URL(string: "javascript:alert(1)")!, sourceURL: index, kind: .linkActivated, bundledRoot: web) == .cancel)
        precondition(WebNavigationPolicy.decide(url: URL(string: "https://user:secret@example.com")!, sourceURL: index, kind: .linkActivated, bundledRoot: web) == .cancel)
        print("Web navigation policy checks passed (bundled-root confinement, symlinks, external activation and scheme allowlist)")
    }
}
