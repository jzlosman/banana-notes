import Foundation

struct ViewerPendingOpenURLs {
    private var urls: [URL] = []

    mutating func append(contentsOf incomingURLs: [URL]) {
        urls.append(contentsOf: incomingURLs)
    }

    mutating func drain() -> [URL] {
        defer { urls.removeAll(keepingCapacity: true) }
        return urls
    }
}
