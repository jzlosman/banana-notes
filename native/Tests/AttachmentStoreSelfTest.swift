import Foundation

@main
struct AttachmentStoreSelfTest {
    static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("FoldnoteAttachments-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("source", isDirectory: true)
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        let store = try AttachmentStore(directory: root.appendingPathComponent("store", isDirectory: true))
        let fixtures: [(String, String, Data)] = [
            ("png", "image/png", Data([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82])),
            ("jpg", "image/jpeg", Data([0xff,0xd8,0xff,0xd9])),
            ("gif", "image/gif", Data("GIF89a".utf8)),
            ("webp", "image/webp", Data("RIFF\u{0c}\u{00}\u{00}\u{00}WEBPVP8 \u{00}\u{00}\u{00}\u{00}".utf8)),
            ("heic", "image/heic", ftyp("heic")),
            ("heif", "image/heic", ftyp("mif1")),
            ("mp3", "audio/mpeg", Data([0xff,0xfb,0x90,0x64])),
            ("m4a", "audio/mp4", ftyp("M4A ")),
            ("wav", "audio/wav", Data("RIFF\u{04}\u{00}\u{00}\u{00}WAVE".utf8)),
            ("mp4", "video/mp4", ftyp("isom")),
            ("mov", "video/quicktime", ftyp("qt  ")),
            ("webm", "video/webm", Data([0x1a,0x45,0xdf,0xa3,0x42,0x82,0x84,0x77,0x65,0x62,0x6d]))
        ]
        for (ext, mime, bytes) in fixtures {
            let record = try store.importBase64(name: "sample.\(ext)", mimeType: mime, base64: bytes.base64EncodedString())
            precondition(record.kind != "" && record.size == bytes.count && record.url.hasPrefix("foldnote-asset://media/"))
            let (persistedURL, resolvedMime) = try store.resolveAssetURL(URL(string: record.url)!)
            let persisted = try Data(contentsOf: persistedURL)
            precondition(persisted == bytes && resolvedMime == mime)
        }
        let beforeInvalid = try FileManager.default.contentsOfDirectory(atPath: store.attachmentsDirectory.path).count
        for (ext, mime, _) in fixtures {
            do {
                _ = try store.importBase64(name: "bogus.\(ext)", mimeType: mime, base64: Data("not a media file".utf8).base64EncodedString())
                preconditionFailure("bogus \(ext) accepted")
            } catch is AttachmentError {}
        }
        let afterInvalid = try FileManager.default.contentsOfDirectory(atPath: store.attachmentsDirectory.path).count
        precondition(afterInvalid == beforeInvalid)
        do { _ = try store.importBase64(name: "bad.png", mimeType: "image/png", base64: "%%%"); preconditionFailure("bad base64 accepted") } catch is AttachmentError {}
        do { _ = try store.importBase64(name: "bad.png", mimeType: "text/html", base64: fixtures[0].2.base64EncodedString()); preconditionFailure("bad MIME accepted") } catch is AttachmentError {}
        let unsupported = source.appendingPathComponent("payload.txt")
        try Data("plain text".utf8).write(to: unsupported)
        do { _ = try store.importURL(unsupported); preconditionFailure("unsupported extension accepted") } catch is AttachmentError {}
        let oversized = source.appendingPathComponent("large.png")
        FileManager.default.createFile(atPath: oversized.path, contents: nil)
        let handle = try FileHandle(forWritingTo: oversized)
        try handle.truncate(atOffset: UInt64(AttachmentStore.maximumBytes + 1))
        try handle.close()
        do { _ = try store.importURL(oversized); preconditionFailure("oversized file accepted") } catch is AttachmentError {}
        do { _ = try store.resolveAssetURL(URL(string: "foldnote-asset://media/../../etc/passwd")!); preconditionFailure("traversal accepted") } catch {}
        let external = source.appendingPathComponent("outside.png")
        try fixtures[0].2.write(to: external)
        let link = source.appendingPathComponent("linked.png")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: external)
        do { _ = try store.importURL(link); preconditionFailure("symlink accepted") } catch {}
        let copied = try store.importURL(external)
        let copiedURL = try store.resolveAssetURL(URL(string: copied.url)!).0
        let copiedData = try Data(contentsOf: copiedURL)
        precondition(copiedData == fixtures[0].2)

        let movedRoot = store.attachmentsDirectory.deletingLastPathComponent().appendingPathComponent("attachments-real")
        try FileManager.default.moveItem(at: store.attachmentsDirectory, to: movedRoot)
        try FileManager.default.createSymbolicLink(at: store.attachmentsDirectory, withDestinationURL: source)
        do { _ = try store.resolveAssetURL(URL(string: copied.url)!); preconditionFailure("swapped attachment root accepted") } catch {}

        let firstRange = try MediaSchemeHandler.byteRange("bytes=1-2", length: 4)
        let suffixRange = try MediaSchemeHandler.byteRange("bytes=-2", length: 4)
        let openRange = try MediaSchemeHandler.byteRange("bytes=2-", length: 4)
        let clampedRange = try MediaSchemeHandler.byteRange("bytes=0-99", length: 4)
        let noRange = try MediaSchemeHandler.byteRange(nil, length: 4)
        precondition(firstRange == 1..<3 && suffixRange == 2..<4 && openRange == 2..<4)
        precondition(clampedRange == 0..<4 && noRange == nil)
        for invalid in ["bytes=8-9", "bytes=1-0", "bytes=", "bytes=1-2,3-4", "bytes=-0", "bytes=999999999999999999999-"] {
            do { _ = try MediaSchemeHandler.byteRange(invalid, length: 4); preconditionFailure("invalid range accepted: \(invalid)") } catch is AttachmentError {}
        }
        print("Attachment signature, root safety, and media range checks passed")
    }

    private static func ftyp(_ brand: String) -> Data {
        var data = Data([0,0,0,16])
        data.append(contentsOf: "ftyp".utf8)
        data.append(contentsOf: brand.utf8)
        data.append(contentsOf: [0,0,0,0])
        return data
    }
}
