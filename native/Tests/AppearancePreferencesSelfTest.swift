import Foundation
@testable import BananaNotesCore

@main
struct AppearancePreferencesSelfTest {
    static func main() throws {
        let suite = "FoldnoteAppearanceTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let bundledCatalogURL = repositoryRoot.appendingPathComponent("web/src/theme-catalog.json")
        let bundledRows = try JSONSerialization.jsonObject(with: Data(contentsOf: bundledCatalogURL)) as? [[String: Any]]
        precondition(bundledRows?.count == 32, "the bundled catalog must include all 32 themes")
        let bundledPreferences = AppearancePreferences(catalogURL: bundledCatalogURL, defaults: defaults)
        precondition(bundledPreferences.catalogError == nil, "all first-party and Agent Paint themes must load")
        let bananaDark = try bundledPreferences.select("banana-dark")
        precondition(bananaDark?.appearance == .dark && bananaDark?.colors.paper == "#1c1a15", "Banana Dark must be selectable with dark appearance")
        defaults.removeObject(forKey: "appearanceTheme")

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(suite, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("themes.json")
        let data = Data("""
        [{"id":"nord","appearance":"dark","colors":{"paper":"#2e3440"}},
         {"id":"github-light","appearance":"light","colors":{"paper":"#ffffff"}}]
        """.utf8)
        try data.write(to: url)
        let preferences = AppearancePreferences(catalogURL: url, defaults: defaults)
        precondition(preferences.selectedID == "system" && preferences.selectedTheme == nil)
        let dark = try preferences.select("nord")
        precondition(dark?.appearance == .dark && dark?.colors.paper == "#2e3440")
        let reloaded = AppearancePreferences(catalogURL: url, defaults: defaults)
        precondition(reloaded.selectedID == "nord", "theme must survive relaunch independently of notes")
        do { _ = try preferences.select("not-a-theme"); preconditionFailure("unknown theme was accepted") }
        catch is StoreError {}
        precondition(preferences.selectedID == "nord", "rejected themes must not replace the saved preference")
        _ = try preferences.select("github-light")
        precondition(preferences.selectedTheme?.appearance == .light)
        _ = try preferences.select("system")
        precondition(preferences.selectedID == "system" && preferences.selectedTheme == nil)
        defaults.set("removed-theme", forKey: "appearanceTheme")
        precondition(preferences.selectedID == "system", "missing themes must safely follow macOS")

        try Data("not json".utf8).write(to: url)
        let broken = AppearancePreferences(catalogURL: url, defaults: defaults)
        precondition(broken.catalogError != nil && broken.selectedID == "system")
        _ = try broken.select("system")
        try Data("[{\"id\":\"bad\",\"appearance\":\"dark\",\"colors\":{\"paper\":\"not-a-color\"}}]".utf8).write(to: url)
        precondition(AppearancePreferences(catalogURL: url, defaults: defaults).catalogError != nil)
        print("Native appearance checks passed (selection, persistence, system fallback, catalog validation)")
    }
}
