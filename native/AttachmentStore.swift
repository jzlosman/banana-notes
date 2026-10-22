import Foundation
import Darwin

struct AttachmentError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct AttachmentRecord: Encodable {
    let id: String
    let name: String
    let kind: String
    let url: String
    let size: Int
    let mimeType: String
    var bridgeValue: [String: Any] { ["id": id, "name": name, "kind": kind, "url": url, "size": size, "mimeType": mimeType] }
}

struct AttachmentStore: AttachmentRepository {
    static let maximumBytes = 50 * 1024 * 1024
    private struct Format { let ext: String; let mime: String; let kind: String }
    private static let formats: [String: Format] = [
        "png": .init(ext: "png", mime: "image/png", kind: "image"),
        "jpg": .init(ext: "jpg", mime: "image/jpeg", kind: "image"), "jpeg": .init(ext: "jpg", mime: "image/jpeg", kind: "image"),
        "gif": .init(ext: "gif", mime: "image/gif", kind: "image"), "webp": .init(ext: "webp", mime: "image/webp", kind: "image"),
        "heic": .init(ext: "heic", mime: "image/heic", kind: "image"), "heif": .init(ext: "heic", mime: "image/heic", kind: "image"),
        "mp3": .init(ext: "mp3", mime: "audio/mpeg", kind: "audio"), "m4a": .init(ext: "m4a", mime: "audio/mp4", kind: "audio"),
        "wav": .init(ext: "wav", mime: "audio/wav", kind: "audio"),
        "mp4": .init(ext: "mp4", mime: "video/mp4", kind: "video"), "mov": .init(ext: "mov", mime: "video/quicktime", kind: "video"),
        "webm": .init(ext: "webm", mime: "video/webm", kind: "video")
    ]
    let directory: URL
    let attachmentsDirectory: URL
    private let fm = FileManager.default

    init(directory: URL) throws {
        self.directory = directory.standardizedFileURL
        self.attachmentsDirectory = directory.appendingPathComponent("attachments", isDirectory: true).standardizedFileURL
        try DurableFileWriter.prepareDirectory(attachmentsDirectory)
        try verifyAttachmentRoot()
    }

    func importBase64(name: String, mimeType: String, base64: String) throws -> AttachmentRecord {
        guard base64.utf8.count <= ((Self.maximumBytes + 2) / 3) * 4 + 8 else { throw AttachmentError(message: "Attachment exceeds the 50 MiB limit.") }
        guard let data = Data(base64Encoded: base64, options: []) else { throw AttachmentError(message: "Attachment data is malformed base64.") }
        return try importBatch([(data: data, name: name, mimeType: mimeType, extHint: URL(fileURLWithPath: name).pathExtension)])[0]
    }

    func importURL(_ url: URL) throws -> AttachmentRecord {
        guard url.isFileURL else { throw AttachmentError(message: "Only local files can be attached.") }
        let path = url.standardizedFileURL.path
        guard !url.pathComponents.contains(".."), !path.isEmpty else { throw AttachmentError(message: "Invalid attachment path.") }
        let attrs = try fm.attributesOfItem(atPath: path)
        guard attrs[.type] as? FileAttributeType == .typeRegular, attrs[.size] as? NSNumber != nil,
              let size = (attrs[.size] as? NSNumber)?.intValue else { throw AttachmentError(message: "Attachment must be a regular file.") }
        guard size <= Self.maximumBytes else { throw AttachmentError(message: "Attachment exceeds the 50 MiB limit.") }
        let resource = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey])
        guard resource.isSymbolicLink != true, resource.isRegularFile == true else { throw AttachmentError(message: "Attachment must be a regular non-symlink file.") }
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        guard data.count <= Self.maximumBytes else { throw AttachmentError(message: "Attachment exceeds the 50 MiB limit.") }
        return try importBatch([(data: data, name: url.lastPathComponent, mimeType: Self.mimeForExtension(url.pathExtension), extHint: url.pathExtension)])[0]
    }

    func importURLs(_ urls: [URL]) throws -> [AttachmentRecord] {
        guard !urls.isEmpty else { return [] }
        let inputs = try urls.map { url -> (data: Data, name: String, mimeType: String, extHint: String) in
            guard url.isFileURL, !url.pathComponents.contains("..") else { throw AttachmentError(message: "Only valid local files can be attached.") }
            let attrs = try fm.attributesOfItem(atPath: url.path)
            guard attrs[.type] as? FileAttributeType == .typeRegular,
                  let size = (attrs[.size] as? NSNumber)?.intValue,
                  try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
                throw AttachmentError(message: "Attachment must be a regular non-symlink file.")
            }
            guard size <= Self.maximumBytes else { throw AttachmentError(message: "Attachment exceeds the 50 MiB limit.") }
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            guard data.count <= Self.maximumBytes else { throw AttachmentError(message: "Attachment exceeds the 50 MiB limit.") }
            return (data, url.lastPathComponent, Self.mimeForExtension(url.pathExtension), url.pathExtension)
        }
        return try importBatch(inputs)
    }

    private struct PendingAttachment {
        let data: Data
        let fileName: String
        let record: AttachmentRecord
    }

    private func importBatch(_ inputs: [(data: Data, name: String, mimeType: String, extHint: String)]) throws -> [AttachmentRecord] {
        try verifyAttachmentRoot()
        let pending = try inputs.map { try prepare(data: $0.data, name: $0.name, mimeType: $0.mimeType, extHint: $0.extHint) }
        let stage = attachmentsDirectory.appendingPathComponent(".staging-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: stage, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? fm.removeItem(at: stage) }
        for item in pending {
            try DurableFileWriter.write(item.data, replacing: stage.appendingPathComponent(item.fileName))
        }
        var committed: [URL] = []
        do {
            for item in pending {
                let destination = attachmentsDirectory.appendingPathComponent(item.fileName)
                try DurableFileWriter.replaceByRename(stage.appendingPathComponent(item.fileName), with: destination)
                committed.append(destination)
            }
        } catch {
            for url in committed where url.deletingLastPathComponent().standardizedFileURL == attachmentsDirectory {
                _ = unlink(url.path)
            }
            throw AttachmentError(message: "Could not finish importing attachments; no files were kept. \(error.localizedDescription)")
        }
        return pending.map(\.record)
    }

    private func prepare(data: Data, name: String, mimeType: String, extHint: String) throws -> PendingAttachment {
        guard !data.isEmpty, data.count <= Self.maximumBytes else { throw AttachmentError(message: "Attachment must be between 1 byte and 50 MiB.") }
        let ext = extHint.lowercased()
        guard let format = Self.formats[ext], mimeType.lowercased().split(separator: ";", maxSplits: 1).first.map(String.init) == format.mime else {
            throw AttachmentError(message: "Unsupported or mismatched attachment MIME type/extension.")
        }
        guard Self.hasValidSignature(data, extension: ext) else { throw AttachmentError(message: "Attachment content does not match its declared format.") }
        let safeName = URL(fileURLWithPath: name).lastPathComponent
        guard !safeName.isEmpty, safeName != ".", safeName != "..", !safeName.contains("/") else { throw AttachmentError(message: "Invalid attachment filename.") }
        let id = UUID().uuidString.lowercased()
        let fileName = "\(id).\(format.ext)"
        let record = AttachmentRecord(id: id, name: safeName, kind: format.kind,
                                      url: "foldnote-asset://media/\(fileName)", size: data.count, mimeType: format.mime)
        return PendingAttachment(data: data, fileName: fileName, record: record)
    }

    /// Removes only old, direct regular files in the managed root that are not
    /// referenced by any active or trashed note. Symlinks and unknown files are skipped.
    func collectGarbage(referencedMarkdown: [String], now: Date = Date(), grace: TimeInterval = 24 * 60 * 60) throws -> Int {
        try verifyAttachmentRoot()
        let pattern = try! NSRegularExpression(pattern: "foldnote-asset://media/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]+)", options: [.caseInsensitive])
        let references = referencedMarkdown.reduce(into: Set<String>()) { result, markdown in
            let range = NSRange(markdown.startIndex..., in: markdown)
            for match in pattern.matches(in: markdown, range: range) where match.numberOfRanges > 1 {
                if let range = Range(match.range(at: 1), in: markdown) { result.insert(String(markdown[range]).lowercased()) }
            }
        }
        let cutoff = now.addingTimeInterval(-grace)
        let directoryFD = open(attachmentsDirectory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directoryFD >= 0 else { throw AttachmentError(message: "The attachments folder is unavailable or unsafe.") }
        defer { _ = close(directoryFD) }
        var directoryInfo = stat()
        guard fstat(directoryFD, &directoryInfo) == 0, (directoryInfo.st_mode & S_IFMT) == S_IFDIR else {
            throw AttachmentError(message: "The attachments folder is not a real directory.")
        }
        let names = try fm.contentsOfDirectory(atPath: attachmentsDirectory.path)
        var removed = 0
        for name in names {
            guard name.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]+$", options: .regularExpression) != nil,
                  !references.contains(name.lowercased()) else { continue }
            var info = stat()
            guard fstatat(directoryFD, name, &info, AT_SYMLINK_NOFOLLOW) == 0,
                  (info.st_mode & S_IFMT) == S_IFREG else { continue }
            let modified = Date(timeIntervalSince1970: TimeInterval(info.st_mtimespec.tv_sec) + TimeInterval(info.st_mtimespec.tv_nsec) / 1_000_000_000)
            guard modified < cutoff else { continue }
            if unlinkat(directoryFD, name, 0) == 0 { removed += 1 }
        }
        return removed
    }

    static func mimeForExtension(_ ext: String) -> String { (formats[ext.lowercased()] ?? Format(ext: "", mime: "", kind: "")).mime }

    private static func hasValidSignature(_ data: Data, extension ext: String) -> Bool {
        func bytes(_ offset: Int, _ expected: [UInt8]) -> Bool {
            offset >= 0 && data.count >= offset + expected.count && data[offset..<(offset + expected.count)].elementsEqual(expected)
        }
        func ascii(_ offset: Int, _ count: Int) -> String? {
            guard offset >= 0, data.count >= offset + count else { return nil }
            return String(bytes: data[offset..<(offset + count)], encoding: .ascii)
        }
        func ftypBrands() -> Set<String> {
            guard ascii(4, 4) == "ftyp", data.count >= 16 else { return [] }
            let boxSize = Int(data[0]) << 24 | Int(data[1]) << 16 | Int(data[2]) << 8 | Int(data[3])
            guard boxSize >= 16, boxSize <= data.count else { return [] }
            var brands: Set<String> = [ascii(8, 4) ?? ""]
            var cursor = 16
            let end = min(boxSize, 4096)
            while cursor + 4 <= end { brands.insert(ascii(cursor, 4) ?? ""); cursor += 4 }
            return brands
        }
        switch ext {
        case "png": return bytes(0, [137, 80, 78, 71, 13, 10, 26, 10]) && ascii(12, 4) == "IHDR"
        case "jpg", "jpeg": return bytes(0, [0xff, 0xd8, 0xff])
        case "gif": return ["GIF87a", "GIF89a"].contains(ascii(0, 6) ?? "")
        case "webp":
            guard ascii(0, 4) == "RIFF", ascii(8, 4) == "WEBP", data.count >= 16 else { return false }
            let size = Int(data[4]) | Int(data[5]) << 8 | Int(data[6]) << 16 | Int(data[7]) << 24
            return size >= 12 && size <= data.count - 8 && ["VP8 ", "VP8L", "VP8X"].contains(ascii(12, 4) ?? "")
        case "heic", "heif": return !ftypBrands().isDisjoint(with: ["heic", "heix", "hevc", "hevx", "mif1", "msf1"])
        case "m4a": return !ftypBrands().isDisjoint(with: ["M4A ", "M4B ", "M4P ", "mp4a"])
        case "mp4": return !ftypBrands().isDisjoint(with: ["isom", "iso2", "mp41", "mp42", "avc1", "M4V "])
        case "mov": return !ftypBrands().isDisjoint(with: ["qt  "])
        case "wav": return ascii(0, 4) == "RIFF" && ascii(8, 4) == "WAVE" && data.count >= 12
        case "mp3":
            if ascii(0, 3) == "ID3" { return data.count >= 10 }
            return data.count >= 2 && data[0] == 0xff && (data[1] & 0xe0) == 0xe0 && (data[1] & 0x18) != 0x08
        case "webm":
            guard bytes(0, [0x1a, 0x45, 0xdf, 0xa3]) else { return false }
            return data.prefix(4096).range(of: Data([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])) != nil
        default: return false
        }
    }

    private func verifyAttachmentRoot() throws {
        let attrs = try fm.attributesOfItem(atPath: attachmentsDirectory.path)
        let resource = try attachmentsDirectory.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
        guard attrs[.type] as? FileAttributeType == .typeDirectory, resource.isDirectory == true, resource.isSymbolicLink != true else {
            throw AttachmentError(message: "Attachment directory must be a real directory.")
        }
    }

    func resolveAssetURL(_ url: URL) throws -> (URL, String) {
        guard url.scheme == "foldnote-asset", url.host == "media", url.user == nil, url.password == nil, url.port == nil,
              url.query == nil, url.fragment == nil else { throw AttachmentError(message: "Invalid managed media URL.") }
        let filename = String(url.path.dropFirst())
        guard filename.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]+$", options: .regularExpression) != nil,
              let ext = filename.split(separator: ".").last.map(String.init), let format = Self.formats[ext] else {
            throw AttachmentError(message: "Invalid managed media identifier.")
        }
        try verifyAttachmentRoot()
        let target = attachmentsDirectory.appendingPathComponent(filename).standardizedFileURL
        guard target.deletingLastPathComponent() == attachmentsDirectory else { throw AttachmentError(message: "Invalid managed media path.") }
        let attrs = try fm.attributesOfItem(atPath: target.path)
        guard attrs[.type] as? FileAttributeType == .typeRegular else { throw AttachmentError(message: "Managed media is unavailable.") }
        let resolvedRoot = attachmentsDirectory.resolvingSymlinksInPath().standardizedFileURL
        let resolvedTarget = target.resolvingSymlinksInPath().standardizedFileURL
        guard resolvedTarget.deletingLastPathComponent() == resolvedRoot else { throw AttachmentError(message: "Managed media is unavailable.") }
        return (target, format.mime)
    }
}
