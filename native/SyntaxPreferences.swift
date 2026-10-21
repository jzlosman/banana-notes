import Foundation

/// Local code-token palette preference, independent of app chrome and note storage.
final class SyntaxPreferences {
    static let appID = "app"
    private let defaults: UserDefaults
    private let catalog: Set<String>
    private let key = "syntaxThemeID"
    let catalogError: String?

    init(defaults: UserDefaults = .standard, catalogURL: URL) {
        self.defaults = defaults
        do {
            let data = try Data(contentsOf: catalogURL)
            guard let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]], !rows.isEmpty else {
                throw StoreError(message: "The bundled syntax theme catalog is invalid.")
            }
            var ids = Set<String>()
            for row in rows {
                guard let id = row["id"] as? String,
                      id.range(of: "^[a-z0-9]+(?:-[a-z0-9]+)*$", options: .regularExpression) != nil,
                      ids.insert(id).inserted else {
                    throw StoreError(message: "The bundled syntax theme catalog is invalid.")
                }
            }
            self.catalog = ids
            self.catalogError = nil
        } catch {
            self.catalog = []
            self.catalogError = "Code themes could not be loaded. Code will use the app palette; your notes are unaffected."
        }
    }

    var selectedID: String {
        guard let value = defaults.string(forKey: key), value == Self.appID || catalog.contains(value) else { return Self.appID }
        return value
    }

    func select(_ id: String) throws {
        guard id == Self.appID || catalog.contains(id) else {
            throw StoreError(message: "This code theme is unavailable. Select another theme or Match app.")
        }
        defaults.set(id, forKey: key)
    }
}
