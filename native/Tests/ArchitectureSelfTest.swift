import Foundation
@testable import BananaNotesCore

@main
struct ArchitectureSelfTest {
    static func main() throws {
        let tests = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        let native = tests.deletingLastPathComponent()
        let pureFiles = ["AppDeepLink.swift", "BridgeCommand.swift", "BridgePayloads.swift", "BridgeSecurityPolicy.swift",
                         "BugReportPolicy.swift", "CrashReportPolicy.swift", "HotkeyPreferences.swift", "LibraryDocument.swift",
                         "LibraryStore.swift", "MarkdownExportService.swift", "MenuAction.swift", "NativePorts.swift",
                         "OllamaResponsePolicy.swift", "PanelMotionState.swift",
                         "PNGExportPolicy.swift", "PreferenceMigration.swift", "SemanticBridgeCommand.swift", "WebCommandChannel.swift",
                         "WebNavigationPolicy.swift", "WindowFocusState.swift", "WindowPreferencePolicy.swift"]
        for name in pureFiles {
            let source = try String(contentsOf: native.appendingPathComponent(name), encoding: .utf8)
            for forbidden in ["import AppKit", "import WebKit", "import Carbon"] {
                precondition(!source.contains(forbidden), "\(name) must remain framework-independent from \(forbidden)")
            }
        }

        let application = try String(contentsOf: native.appendingPathComponent("AppDelegate.swift"), encoding: .utf8)
        let runtime = try String(contentsOf: native.appendingPathComponent("NativeApplicationRuntime.swift"), encoding: .utf8)
        let features = try String(contentsOf: native.appendingPathComponent("NativeFeatures.swift"), encoding: .utf8)
        let ports = try String(contentsOf: native.appendingPathComponent("NativePorts.swift"), encoding: .utf8)
        let reportingAdapters = try String(contentsOf: native.appendingPathComponent("BugReportAndCrashReportAdapters.swift"), encoding: .utf8)
        let bridge = try String(contentsOf: native.appendingPathComponent("BridgeCommand.swift"), encoding: .utf8)
        precondition(application.split(separator: "\n").count < 200, "AppDelegate must stay a small lifecycle adapter")
        let migrationStart = application.range(of: "UserDefaultsPreferenceMigration().migrate")!.lowerBound
        let runtimeStart = application.range(of: "NativeApplicationRuntime(appURL:")!.lowerBound
        precondition(migrationStart < runtimeStart, "preference migration must run before the runtime reads preferences")
        precondition(application.contains("StartupPreferences().configureLaunchAtLogin(true)"),
                     "a migrated launch-at-login opt-in must register for the new bundle identity")
        precondition(runtime.contains("BridgeRouter(handlers: makeBridgeHandlers())"), "composition root must own capability wiring")
        precondition(runtime.contains("CrashReportPromptAdapter") && runtime.contains("BugReportController"),
                     "the composition root wires report menus and launch prompts")
        precondition(ports.contains("protocol CrashReportRepository"), "crash-report file access must use a native port")
        precondition(reportingAdapters.contains("NSWorkspace.shared.activateFileViewerSelecting"),
                     "Finder access belongs to the native adapter")
        precondition(features.contains("any AttachmentRepository"), "feature adapters must depend on the attachment port")
        precondition(features.contains("any PreferencesStore"), "feature adapters must depend on the preference port")
        precondition(!features.contains("FeatureBridgeCapability") && !features.contains("handleFeatureBridge"),
                     "NativeFeatures is a service composition, not a monolithic bridge handler")
        precondition(!bridge.contains("BridgeJSONValue") && !bridge.contains("DecodedBridgeRequest"),
                     "the bridge must decode directly into a typed command")
        precondition(bridge.contains("protocol BridgeHandler") && bridge.contains("func route(_ command: BridgeCommand"),
                     "the router accepts typed commands and capability handlers")
        for name in ["ApplicationBridgeHandlers.swift", "PreferencesBridgeHandler.swift", "AttachmentBridgeHandler.swift",
                     "FontBridgeHandler.swift", "PNGExportBridgeHandler.swift", "SemanticBridgeHandler.swift",
                     "MarkdownExportBridgeHandler.swift"] {
            let source = try String(contentsOf: native.appendingPathComponent(name), encoding: .utf8)
            precondition(source.contains(": BridgeHandler"), "\(name) must implement a bridge capability")
            precondition(!source.contains("body: [String: Any]") && !source.contains("payload: [String: Any]"),
                         "\(name) must receive decoded values rather than dictionaries")
        }
        print("Native architecture boundary checks passed (ports, typed router, handlers, pure policy, lifecycle adapter)")
    }
}
