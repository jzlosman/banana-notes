import Foundation

/// Pure authorization decision for messages arriving from WebKit frames.
enum BridgeSecurityPolicy {
    static func allows(isMainFrame: Bool, frameURL: URL?, bundledIndexURL: URL) -> Bool {
        guard isMainFrame, let frameURL, frameURL.isFileURL, bundledIndexURL.isFileURL else { return false }
        return frameURL.resolvingSymlinksInPath().standardizedFileURL ==
            bundledIndexURL.resolvingSymlinksInPath().standardizedFileURL
    }
}
