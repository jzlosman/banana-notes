import Foundation

struct ViewerRecentDocumentMenuItem: Equatable {
    let url: URL
    let filename: String
    let parentFolderName: String
    let hasDuplicateFilename: Bool
    let isCurrentDocument: Bool

    var fallbackTitle: String {
        hasDuplicateFilename ? "\(filename) — \(parentFolderName)" : filename
    }
}

enum ViewerRecentDocumentMenuBuilder {
    static let maximumItems = 10

    /// Recents are supplied newest-first by ViewerPreferencesStore. This pure projection filters missing
    /// files, applies the visible-item cap, then derives the labels and current-document state.
    static func build(recentURLs: [URL], fileExists: (URL) -> Bool,
                      currentDocumentURL: URL?) -> [ViewerRecentDocumentMenuItem] {
        let existing = Array(recentURLs.lazy.filter(fileExists).prefix(maximumItems))
        let nameCounts = Dictionary(grouping: existing, by: \.lastPathComponent).mapValues(\.count)
        let currentPath = currentDocumentURL?.standardizedFileURL.path

        return existing.map { url in
            let filename = url.lastPathComponent
            let parent = url.deletingLastPathComponent()
            let parentName = parent.lastPathComponent.isEmpty ? parent.path : parent.lastPathComponent
            return ViewerRecentDocumentMenuItem(
                url: url,
                filename: filename,
                parentFolderName: parentName,
                hasDuplicateFilename: (nameCounts[filename] ?? 0) > 1,
                isCurrentDocument: currentPath == url.standardizedFileURL.path)
        }
    }
}
