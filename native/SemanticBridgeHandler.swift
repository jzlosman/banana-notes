import Foundation

@MainActor
final class SemanticBridgeHandler: BridgeHandler {
    let capability = BridgeCapability.semantic
    private let search: SemanticSearchService

    init(search: SemanticSearchService) { self.search = search }

    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        guard case .semantic(let request) = command else {
            throw StoreError(message: "Semantic search bridge does not support this command.")
        }
        Task {
            do { reply(try await search.handle(request), nil) }
            catch { reply(nil, error.localizedDescription) }
        }
    }
}
