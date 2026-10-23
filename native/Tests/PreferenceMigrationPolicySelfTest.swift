import Foundation
@testable import BananaNotesCore

@main struct PreferenceMigrationPolicySelfTest {
    static func main() {
        let legacy: [String: Any] = [
            "theme": "banana-dark",
            "globalHotkey": ["keyCode": 49],
            "launchAtLogin": true,
            "NSWindow Frame MainWindow": "0 0 400 500",
            "NSColorPanel mode": "legacy",
            "AppleLanguages": ["en-US"],
            "com.apple.AppleLanguages": ["en-US"],
            "WebKitStorageAccess": true
        ]
        let current = ["theme": "banana-light"] as [String: Any]
        let decision = PreferenceMigrationPolicy.decide(
            legacyPreferences: legacy,
            currentPreferences: current,
            hasMigrated: false,
            bundleIdentifier: PreferenceMigrationPolicy.currentBundleIdentifier)

        precondition(decision.valuesToCopy["globalHotkey"] != nil, "legacy preferences must be copied")
        precondition(decision.valuesToCopy["launchAtLogin"] as? Bool == true && decision.shouldRegisterLaunchAtLogin,
                     "a copied launch-at-login setting must request registration for the new bundle")
        precondition(decision.valuesToCopy["theme"] == nil, "existing new-domain preferences must win")
        precondition(decision.valuesToCopy["NSWindow Frame MainWindow"] as? String == "0 0 400 500",
                     "NSWindow Frame preferences are safe to copy")
        for key in ["NSColorPanel mode", "AppleLanguages", "com.apple.AppleLanguages", "WebKitStorageAccess"] {
            precondition(decision.valuesToCopy[key] == nil, "system preference \(key) must not be copied")
        }
        precondition(decision.shouldMarkMigrated, "a non-empty legacy domain must be marked after migration")

        let repeated = PreferenceMigrationPolicy.decide(
            legacyPreferences: legacy,
            currentPreferences: current,
            hasMigrated: true,
            bundleIdentifier: PreferenceMigrationPolicy.currentBundleIdentifier)
        precondition(repeated.valuesToCopy.isEmpty && !repeated.shouldMarkMigrated,
                     "the migration marker must make migration idempotent")

        let verification = PreferenceMigrationPolicy.decide(
            legacyPreferences: legacy,
            currentPreferences: [:],
            hasMigrated: false,
            bundleIdentifier: "\(PreferenceMigrationPolicy.verificationBundlePrefix)test")
        precondition(verification.valuesToCopy.isEmpty && !verification.shouldMarkMigrated,
                     "verification bundles must not read or mark the real legacy domain")

        verifyUserDefaultsAdapter()
        print("Preference migration policy checks passed")
    }

    private static func verifyUserDefaultsAdapter() {
        let suffix = UUID().uuidString
        let legacyDomain = "BananaNotesMigrationLegacy-\(suffix)"
        let currentDomain = "BananaNotesMigrationCurrent-\(suffix)"
        let legacyDefaults = UserDefaults(suiteName: legacyDomain)!
        let currentDefaults = UserDefaults(suiteName: currentDomain)!
        defer {
            legacyDefaults.removePersistentDomain(forName: legacyDomain)
            currentDefaults.removePersistentDomain(forName: currentDomain)
        }

        legacyDefaults.set("legacy-dark", forKey: "theme")
        legacyDefaults.set(true, forKey: "launchAtLogin")
        currentDefaults.set("new-light", forKey: "theme")

        let migration = UserDefaultsPreferenceMigration(legacyDomain: legacyDomain)
        let first = migration.migrate(bundleIdentifier: currentDomain, defaults: currentDefaults)
        precondition(first.shouldRegisterLaunchAtLogin, "the adapter must expose migrated login registration")
        precondition(currentDefaults.string(forKey: "theme") == "new-light", "the adapter must preserve current values")
        precondition(currentDefaults.bool(forKey: "launchAtLogin"), "the adapter must copy absent legacy values")
        precondition(currentDefaults.bool(forKey: PreferenceMigrationPolicy.markerKey), "the adapter must persist the marker")
        precondition(legacyDefaults.string(forKey: "theme") == "legacy-dark", "the adapter must leave legacy preferences intact")

        let second = migration.migrate(bundleIdentifier: currentDomain, defaults: currentDefaults)
        precondition(second.valuesToCopy.isEmpty && !second.shouldRegisterLaunchAtLogin,
                     "a completed adapter migration must not repeat")
    }
}
