import WebKit

@MainActor
final class NativeBridgeMessageAdapter: NSObject, WKScriptMessageHandlerWithReply {
    private let bundledIndexURL: URL
    var router: BridgeRouter?

    init(bundledIndexURL: URL) { self.bundledIndexURL = bundledIndexURL }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard BridgeSecurityPolicy.allows(isMainFrame: message.frameInfo.isMainFrame,
                                          frameURL: message.frameInfo.request.url,
                                          bundledIndexURL: bundledIndexURL) else {
            replyHandler(nil, "Native requests are allowed only from the bundled Banana Notes editor.")
            return
        }
        do {
            let command = try BridgeCommandDecoder.decode(message.body)
            guard let router else { throw StoreError(message: "Native application services are not ready.") }
            try router.route(command, reply: replyHandler)
        } catch { replyHandler(nil, error.localizedDescription) }
    }
}
