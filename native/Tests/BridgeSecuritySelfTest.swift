import Foundation

@MainActor
private final class RecordingBridgeHandler: BridgeHandler {
    let capability: BridgeCapability
    private(set) var handledLoad = false
    init(capability: BridgeCapability) { self.capability = capability }
    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        guard case .load = command else { throw StoreError(message: "Unexpected test command.") }
        handledLoad = true
        reply(["ok": true], nil)
    }
}

@main
struct BridgeSecuritySelfTest {
    @MainActor static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("BridgePolicy-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let index = root.appendingPathComponent("index.html")
        try Data("bundled editor".utf8).write(to: index)
        precondition(BridgeSecurityPolicy.allows(isMainFrame: true, frameURL: index, bundledIndexURL: index))
        precondition(!BridgeSecurityPolicy.allows(isMainFrame: false, frameURL: index, bundledIndexURL: index))
        precondition(!BridgeSecurityPolicy.allows(isMainFrame: true, frameURL: URL(string: "https://example.com/index.html"), bundledIndexURL: index))
        precondition(!BridgeSecurityPolicy.allows(isMainFrame: true, frameURL: root.appendingPathComponent("other.html"), bundledIndexURL: index))
        precondition(!BridgeSecurityPolicy.allows(isMainFrame: true, frameURL: nil, bundledIndexURL: index))

        if case .libraryRecovery = try BridgeCommandDecoder.decode(["action": "libraryRecovery"]) {} else {
            preconditionFailure("known recovery action must decode to its typed command")
        }
        let validLibrary: [String: Any] = ["version": 1, "notes": [], "selectedID": NSNull(), "activeTag": NSNull()]
        if case .save(let library) = try BridgeCommandDecoder.decode(["action": "save", "library": validLibrary]) {
            precondition(library.version == 1 && library.notes.isEmpty)
        } else { preconditionFailure("save must produce an invariant-bearing library document") }
        if case .windowStyle(let style) = try BridgeCommandDecoder.decode(["action": "windowStyle", "style": [
            "focusedOpacity": 0.8, "unfocusedOpacity": 0.5, "glass": 0.3]]) {
            precondition(style.focusedOpacity == 0.8)
        } else { preconditionFailure("window settings must decode into a typed value") }

        let invalid: [[String: Any]] = [
            ["action": "unknownBridgeAction"],
            ["action": "save", "library": ["version": true, "notes": [], "selectedID": NSNull(), "activeTag": NSNull()]],
            ["action": "save", "library": ["version": 1, "notes": [], "activeTag": NSNull()]],
            ["action": "pin", "pinned": "yes"],
            ["action": "featurePreferences", "ocrEnabled": 1],
            ["action": "windowStyle", "style": ["focusedOpacity": 0, "unfocusedOpacity": 1, "glass": 0]],
            ["action": "clipboard", "content": ["text": true]],
            ["action": "startupPreferences", "launchAtLogin": NSNull()],
            ["action": "semanticSearch", "query": "test", "candidateIDs": "not-an-array"]
        ]
        for request in invalid {
            do { _ = try BridgeCommandDecoder.decode(request); preconditionFailure("invalid bridge request accepted: \(request)") }
            catch is BridgeDecodeError {}
        }
        do {
            _ = try BridgeCommandDecoder.decode(["action": "load", "payload": Date()])
            preconditionFailure("non-JSON values must be rejected at the boundary")
        } catch is BridgeDecodeError {}

        let handler = RecordingBridgeHandler(capability: .application)
        let router = BridgeRouter(handlers: [handler])
        try router.route(.load) { _, _ in }
        precondition(handler.handledLoad, "router dispatches a decoded command to its capability owner")
        do { try router.route(.quit) { _, _ in }; preconditionFailure("unavailable capabilities must fail closed") }
        catch is StoreError {}
        print("Native bridge frame authorization, typed routing and decoding checks passed")
    }
}
