import Foundation

struct CatalogTheme: Decodable {
    enum Appearance: String, Decodable { case light, dark }
    struct Colors: Decodable { let paper: String }
    let id: String
    let name: String?
    let appearance: Appearance
    let colors: Colors
}

/// Appearance settings are independent of the note repository. The bundled
/// catalog, not bridge-supplied colors or paths, determines native chrome.
final class AppearancePreferences {
    static let systemID = "system"
    private let defaults: any PreferencesStore
    private let catalog: [String: CatalogTheme]
    let catalogError: String?
    private let key = "appearanceTheme"

    init(catalogURL: URL, defaults: any PreferencesStore = UserDefaults.standard) {
        self.defaults = defaults
        do {
            let themes = try JSONDecoder().decode([CatalogTheme].self, from: Data(contentsOf: catalogURL))
            var catalog: [String: CatalogTheme] = [:]
            for theme in themes {
                guard theme.id != Self.systemID,
                      theme.id.range(of: "^[a-z0-9]+(?:-[a-z0-9]+)*$", options: .regularExpression) != nil,
                      theme.colors.paper.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil,
                      catalog[theme.id] == nil else {
                    throw StoreError(message: "The bundled theme catalog is invalid.")
                }
                catalog[theme.id] = theme
            }
            self.catalog = catalog
            self.catalogError = nil
        } catch {
            self.catalog = [:]
            self.catalogError = "Themes could not be loaded. Banana Notes is using system appearance; your notes are unaffected."
        }
    }

    var selectedID: String {
        guard let id = defaults.string(forKey: key), catalog[id] != nil else { return Self.systemID }
        return id
    }
    var selectedTheme: CatalogTheme? { catalog[selectedID] }

    @discardableResult
    func select(_ id: String) throws -> CatalogTheme? {
        guard id == Self.systemID || catalog[id] != nil else {
            throw StoreError(message: "This theme is unavailable. Select another theme or Follow macOS.")
        }
        defaults.set(id, forKey: key)
        return catalog[id]
    }
}
