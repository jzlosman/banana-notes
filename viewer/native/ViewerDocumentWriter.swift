import Foundation

struct ViewerDocumentWriter {
    static func save(canonicalURL: URL, using resourceRoot: ViewerRasterResourceReader?, expectedRevision: String,
                     markdown: String, isUnlocked: Bool) -> ViewerSaveResult {
        guard isUnlocked else { return .failed(reason: .unknown) }
        guard expectedRevision.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              canonicalURL.isFileURL,
              ViewerDocumentReader.supportedExtensions.contains(canonicalURL.pathExtension.lowercased()) else {
            return .failed(reason: .unknown)
        }
        let bytes = Data(markdown.utf8)
        guard bytes.count <= ViewerDocumentReader.maximumBytes else { return .failed(reason: .tooLarge) }
        do {
            let root = try resourceRoot ?? ViewerRasterResourceReader(canonicalDocumentDirectory: canonicalURL.deletingLastPathComponent())
            let current = try ViewerDocumentReader.read(canonicalURL: canonicalURL, using: root)
            guard current.revision == expectedRevision else { return .conflict }
            guard current.sourceData != bytes else { return .saved(revision: current.revision) }
            try root.replaceDocumentAtomically(filename: canonicalURL.lastPathComponent, data: bytes,
                                               maximumBytes: ViewerDocumentReader.maximumBytes)
            let saved = try ViewerDocumentReader.read(canonicalURL: canonicalURL, using: root)
            return .saved(revision: saved.revision)
        } catch let error as ViewerFileWriteError {
            switch error {
            case .readOnlyFile: return .failed(reason: .readOnlyFile)
            case .permissionDenied: return .failed(reason: .permissionDenied)
            case .tooLarge: return .failed(reason: .tooLarge)
            case .unknown: return .failed(reason: .unknown)
            }
        } catch let error as ViewerError {
            if error == .tooLarge { return .failed(reason: .tooLarge) }
            return .failed(reason: .unknown)
        } catch {
            return .failed(reason: .unknown)
        }
    }
}

enum ViewerFileWriteError: Error {
    case readOnlyFile
    case permissionDenied
    case tooLarge
    case unknown
}
