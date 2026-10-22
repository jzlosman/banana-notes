import Foundation

@MainActor
final class UnavailableBridgeHandler: BridgeHandler {
    let capability: BridgeCapability
    init(capability: BridgeCapability) { self.capability = capability }

    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        throw StoreError(message: "Native features are unavailable until the application data folder can be prepared.")
    }
}
