import Foundation

@main
struct BridgeSecuritySelfTest {
    static func main() throws {
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

        let decoded = try BridgeCommandDecoder.decode(["action": "libraryRecovery"])
        if case .libraryRecovery = decoded.command {} else { preconditionFailure("known recovery action must decode to its typed command") }
        do {
            _ = try BridgeCommandDecoder.decode(["action": "unknownBridgeAction"])
            preconditionFailure("unknown bridge actions must be rejected at the boundary")
        } catch is BridgeDecodeError {}
        do {
            _ = try BridgeCommandDecoder.decode(["action": "load", "payload": Date()])
            preconditionFailure("non-JSON values must be rejected at the boundary")
        } catch is BridgeDecodeError {}
        print("Native bridge frame authorization and typed decoding checks passed")
    }
}
