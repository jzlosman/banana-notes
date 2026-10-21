import Foundation

@main
struct SyntaxPreferencesSelfTest {
    static func main() throws {
        let suite = "FoldnoteSyntaxTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(suite, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("themes.json")
        try Data("[\"".utf8).write(to: url)
        let json = """
        [{"id":"one-dark","appearance":"dark","colors":{"paper":"#222222"}},
         {"id":"github-light","appearance":"light","colors":{"paper":"#ffffff"}}]
        """
        try Data(json.utf8).write(to: url)
        let preferences = SyntaxPreferences(defaults: defaults, catalogURL: url)
        precondition(preferences.selectedID == "app" && preferences.catalogError == nil)
        try preferences.select("one-dark")
        precondition(SyntaxPreferences(defaults: defaults, catalogURL: url).selectedID == "one-dark", "syntax choice persists separately")
        try preferences.select("app")
        precondition(preferences.selectedID == "app")
        do { try preferences.select("unknown"); preconditionFailure("unknown syntax theme accepted") }
        catch is StoreError {}
        try Data("not json".utf8).write(to: url)
        let invalid = SyntaxPreferences(defaults: defaults, catalogURL: url)
        precondition(invalid.selectedID == "app" && invalid.catalogError != nil)
        do { try invalid.select("one-dark"); preconditionFailure("invalid catalog accepted") }
        catch is StoreError {}
        print("Native syntax preference checks passed")
    }
}
