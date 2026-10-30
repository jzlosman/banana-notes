import Foundation

/// The containing app's bundle identifier supplies an isolated UserDefaults domain.
/// This adapter stores only viewer settings and recent viewer documents.
final class ViewerPreferencesStore: ViewerDefaultApplicationMemory {
    private let defaults: UserDefaults
    private let catalog: ViewerCatalog
    private let key = "viewerPreferences.v1"
    private let recentsKey = "viewerRecentDocuments.v1"
    private let previousDefaultAppKey = "viewerPreviousDefaultAppBundleIdentifier.v1"

    init(defaults: UserDefaults = .standard, catalog: ViewerCatalog) {
        self.defaults = defaults
        self.catalog = catalog
    }

    var preferences: ViewerPreferences {
        guard let data = defaults.data(forKey: key),
              let saved = try? JSONDecoder().decode(ViewerPreferences.self, from: data),
              (try? saved.validate(using: catalog)) != nil else { return .defaults }
        return saved
    }

    func save(_ preferences: ViewerPreferences) throws {
        try preferences.validate(using: catalog)
        defaults.set(try JSONEncoder().encode(preferences), forKey: key)
    }

    var recentDocumentURLs: [URL] {
        let paths = defaults.stringArray(forKey: recentsKey) ?? []
        var seen = Set<String>()
        return paths.compactMap { path in
            let url = ViewerDocumentReader.canonicalURL(for: URL(fileURLWithPath: path))
            guard ViewerDocumentReader.supportedExtensions.contains(url.pathExtension.lowercased()),
                  seen.insert(url.path).inserted else { return nil }
            return url
        }
    }

    var previousDefaultApplicationBundleIdentifier: ViewerBundleIdentifier? {
        guard let rawValue = defaults.string(forKey: previousDefaultAppKey) else { return nil }
        guard let identifier = ViewerBundleIdentifier(rawValue) else {
            defaults.removeObject(forKey: previousDefaultAppKey)
            return nil
        }
        return identifier
    }

    func rememberPreviousDefaultApplication(_ identifier: ViewerBundleIdentifier?) {
        if let identifier { defaults.set(identifier.rawValue, forKey: previousDefaultAppKey) }
        else { defaults.removeObject(forKey: previousDefaultAppKey) }
    }

    func clearRecentDocuments() { defaults.removeObject(forKey: recentsKey) }

    func recordRecent(_ url: URL) {
        let canonical = ViewerDocumentReader.canonicalURL(for: url)
        guard ViewerDocumentReader.supportedExtensions.contains(canonical.pathExtension.lowercased()) else { return }
        var paths = [canonical.path]
        paths.append(contentsOf: recentDocumentURLs.map(\.path).filter { $0 != canonical.path })
        defaults.set(Array(paths.prefix(10)), forKey: recentsKey)
    }
}
