import Foundation

@main
struct FeaturePreferencesSelfTest {
    static func main() throws {
        let name = "FoldnoteFeatureTest-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let prefs = FeaturePreferences(defaults: defaults)
        precondition(!prefs.ocrEnabled)
        prefs.setOCR(true); precondition(FeaturePreferences(defaults: defaults).ocrEnabled)
        precondition(prefs.ocrEnabled)
        prefs.setOCR(false); precondition(!prefs.ocrEnabled)
        print("Optional feature preference checks passed")
    }
}
