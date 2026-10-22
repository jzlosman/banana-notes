import WebKit

@MainActor
final class WebKitCommandTransport {
    private weak var webView: WKWebView?

    init(webView: WKWebView) { self.webView = webView }

    func send(_ command: WebCommand) {
        guard let webView, let argument = try? command.jsonArgument() else { return }
        webView.evaluateJavaScript("window.foldnoteCommand && window.foldnoteCommand(\(argument));", completionHandler: nil)
    }

    func flush(_ completion: @escaping WebCommandChannel.Completion) {
        guard let webView else {
            completion(.failure(StoreError(message: "The note editor is unavailable.")))
            return
        }
        webView.callAsyncJavaScript(
            "if (typeof window.foldnoteCommand !== 'function') throw new Error('The editor flush command is unavailable'); await window.foldnoteCommand({action: 'flush'}); return true;",
            arguments: [:], in: nil, in: .page,
            completionHandler: { (result: Result<Any, Error>) in
                switch result {
                case .success: completion(.success(()))
                case .failure(let error): completion(.failure(error))
                }
            })
    }
}
