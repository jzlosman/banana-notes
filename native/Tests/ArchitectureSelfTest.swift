import Foundation

@main
struct ArchitectureSelfTest {
    static func main() throws {
        let tests = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        let native = tests.deletingLastPathComponent()
        let pureFiles = ["BridgeCommand.swift", "BridgeSecurityPolicy.swift", "HotkeyPreferences.swift",
                         "LibraryStore.swift", "NativePorts.swift", "OllamaResponsePolicy.swift", "WindowFocusState.swift"]
        for name in pureFiles {
            let source = try String(contentsOf: native.appendingPathComponent(name), encoding: .utf8)
            for forbidden in ["import AppKit", "import WebKit", "import Carbon"] {
                precondition(!source.contains(forbidden), "\(name) must remain framework-independent from \(forbidden)")
            }
        }
        let application = try String(contentsOf: native.appendingPathComponent("AppDelegate.swift"), encoding: .utf8)
        let features = try String(contentsOf: native.appendingPathComponent("NativeFeatures.swift"), encoding: .utf8)
        precondition(application.contains("any LibraryRepository"), "composition root depends on the library port")
        precondition(features.contains("any AttachmentRepository"), "feature adapter depends on the attachment port")
        precondition(features.contains("any PreferencesStore"), "feature adapter depends on the preference port")
        precondition(!features.contains("FileManager.default"), "feature handler must not reach around its repository ports")
        precondition(!application.contains("case \"load\""), "untrusted string dispatch belongs to BridgeCommandDecoder only")
        print("Native architecture boundary checks passed")
    }
}
