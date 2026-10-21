import Foundation

@main
struct FeaturePreferencesSelfTest {
    static func main() throws {
        let name = "FoldnoteFeatureTest-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let prefs = FeaturePreferences(defaults: defaults)
        precondition(!prefs.ocrEnabled)
        try prefs.setOCR(true); precondition(FeaturePreferences(defaults: defaults).ocrEnabled)
        for invalid: Any in ["true", 1, NSNull()] {
            do { try prefs.setOCR(invalid); preconditionFailure("invalid OCR preference accepted") } catch is StoreError {}
        }
        precondition(prefs.ocrEnabled)
        try prefs.setOCR(false); precondition(!prefs.ocrEnabled)
        print("Optional feature preference checks passed")
    }
}
