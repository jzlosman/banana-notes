import CryptoKit
import Darwin
import Foundation

struct ViewerFileFingerprint: Equatable {
    let size: Int
    let modifiedAt: TimeInterval
    let device: UInt64
    let inode: UInt64
}

struct ViewerReadResult {
    let canonicalURL: URL
    let fingerprint: ViewerFileFingerprint
    let markdown: String
    let sourceData: Data
    let revision: String
    let resourceRoot: ViewerRasterResourceReader
}

struct ViewerDocumentReader {
    static let maximumBytes = 8 * 1024 * 1024
    static let supportedExtensions: Set<String> = ["md", "markdown", "mdown", "mkd"]

    /// Resolve selected aliases once at the filesystem adapter boundary.
    static func documentID(for canonicalURL: URL) -> String {
        SHA256.hash(data: Data(canonicalURL.path.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func canonicalURL(for url: URL) -> URL {
        let standardized = url.standardizedFileURL
        guard standardized.isFileURL else { return standardized }
        let canonicalPath = standardized.path.withCString { source -> String? in
            guard let resolved = realpath(source, nil) else { return nil }
            defer { free(resolved) }
            return String(cString: resolved)
        } ?? standardized.resolvingSymlinksInPath().standardizedFileURL.path
        return URL(fileURLWithPath: canonicalPath, isDirectory: url.hasDirectoryPath)
    }

    static func read(_ url: URL) throws -> ViewerReadResult {
        guard url.isFileURL else { throw ViewerError.unavailable }
        return try read(canonicalURL: canonicalURL(for: url))
    }

    /// Input is already canonicalized by the file adapter. Pin its parent before
    /// opening the Markdown file, then use that same descriptor for images.
    static func read(canonicalURL: URL) throws -> ViewerReadResult {
        guard canonicalURL.isFileURL,
              supportedExtensions.contains(canonicalURL.pathExtension.lowercased()) else {
            throw ViewerError.unsupportedFile
        }
        let root: ViewerRasterResourceReader
        do { root = try ViewerRasterResourceReader(canonicalDocumentDirectory: canonicalURL.deletingLastPathComponent()) }
        catch { throw ViewerError.unavailable }
        return try read(canonicalURL: canonicalURL, using: root)
    }

    static func read(canonicalURL: URL, using resourceRoot: ViewerRasterResourceReader) throws -> ViewerReadResult {
        let pathComponents = canonicalURL.path.split(separator: "/")
        guard canonicalURL.isFileURL, canonicalURL.path.hasPrefix("/"),
              pathComponents.allSatisfy({ $0 != "." && $0 != ".." }),
              canonicalURL.deletingLastPathComponent().path == resourceRoot.directoryPath,
              supportedExtensions.contains(canonicalURL.pathExtension.lowercased()) else {
            throw ViewerError.unavailable
        }
        let contents = try resourceRoot.readDocument(filename: canonicalURL.lastPathComponent, maximumBytes: maximumBytes)
        guard let markdown = String(data: contents.data, encoding: .utf8) else { throw ViewerError.invalidUTF8 }
        let digest = SHA256.hash(data: contents.data).map { String(format: "%02x", $0) }.joined()
        return ViewerReadResult(canonicalURL: canonicalURL, fingerprint: contents.fingerprint,
                                markdown: markdown, sourceData: contents.data, revision: digest, resourceRoot: resourceRoot)
    }

    static func fingerprint(_ url: URL) throws -> ViewerFileFingerprint {
        guard url.isFileURL else { throw ViewerError.unavailable }
        return try fingerprint(canonicalURL: canonicalURL(for: url))
    }

    static func fingerprint(canonicalURL: URL) throws -> ViewerFileFingerprint {
        guard canonicalURL.isFileURL else { throw ViewerError.unavailable }
        let root: ViewerRasterResourceReader
        do { root = try ViewerRasterResourceReader(canonicalDocumentDirectory: canonicalURL.deletingLastPathComponent()) }
        catch { throw ViewerError.unavailable }
        return try root.fingerprint(filename: canonicalURL.lastPathComponent)
    }
}
