import Foundation

/// Pure migration policy for the one-time move from the development defaults
/// domain to the public application identity.
struct PreferenceMigrationDecision {
    let valuesToCopy: [String: Any]
    let shouldMarkMigrated: Bool

    var shouldRegisterLaunchAtLogin: Bool {
        valuesToCopy["launchAtLogin"] as? Bool == true
    }
}

enum PreferenceMigrationPolicy {
    static let currentBundleIdentifier = "com.jzlosman.banana-notes"
    static let legacyBundleIdentifier = "dev.local.foldnote"
    static let verificationBundlePrefix = "com.jzlosman.banana-notes.verification."
    static let markerKey = "legacyPreferencesMigrated"

    static func decide(legacyPreferences: [String: Any]?, currentPreferences: [String: Any],
                       hasMigrated: Bool, bundleIdentifier: String?) -> PreferenceMigrationDecision {
        guard let bundleIdentifier,
              !bundleIdentifier.hasPrefix(verificationBundlePrefix),
              !hasMigrated,
              let legacyPreferences,
              !legacyPreferences.isEmpty else {
            return PreferenceMigrationDecision(valuesToCopy: [:], shouldMarkMigrated: false)
        }

        let valuesToCopy = legacyPreferences.reduce(into: [String: Any]()) { result, entry in
            guard currentPreferences[entry.key] == nil, !isSystemKey(entry.key) else { return }
            result[entry.key] = entry.value
        }
        return PreferenceMigrationDecision(valuesToCopy: valuesToCopy, shouldMarkMigrated: true)
    }

    private static func isSystemKey(_ key: String) -> Bool {
        if key.hasPrefix("NSWindow Frame") { return false }
        return ["NS", "Apple", "com.apple.", "WebKit"].contains(where: key.hasPrefix)
    }
}

/// UserDefaults adapter. It reads and writes only the explicit application
/// domains; key-selection and overwrite policy remain in PreferenceMigrationPolicy.
struct UserDefaultsPreferenceMigration {
    private let legacyDomain: String

    init(legacyDomain: String = PreferenceMigrationPolicy.legacyBundleIdentifier) {
        self.legacyDomain = legacyDomain
    }

    @discardableResult
    func migrate(bundleIdentifier: String?, defaults: UserDefaults = .standard) -> PreferenceMigrationDecision {
        guard let bundleIdentifier,
              !bundleIdentifier.hasPrefix(PreferenceMigrationPolicy.verificationBundlePrefix) else {
            return PreferenceMigrationDecision(valuesToCopy: [:], shouldMarkMigrated: false)
        }

        let current = defaults.persistentDomain(forName: bundleIdentifier) ?? [:]
        guard current[PreferenceMigrationPolicy.markerKey] as? Bool != true else {
            return PreferenceMigrationDecision(valuesToCopy: [:], shouldMarkMigrated: false)
        }
        let decision = PreferenceMigrationPolicy.decide(
            legacyPreferences: defaults.persistentDomain(forName: legacyDomain),
            currentPreferences: current,
            hasMigrated: false,
            bundleIdentifier: bundleIdentifier)

        for (key, value) in decision.valuesToCopy {
            defaults.set(value, forKey: key)
        }
        if decision.shouldMarkMigrated {
            defaults.set(true, forKey: PreferenceMigrationPolicy.markerKey)
        }
        return decision
    }
}
