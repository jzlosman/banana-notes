import Foundation
import CryptoKit
import CoreFoundation

struct NoteFontError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct FontHTTPResponse {
    let data: Data
    let statusCode: Int
    let finalURL: URL
}

protocol FontHTTPClient {
    func get(_ url: URL, maximumBytes: Int) async throws -> FontHTTPResponse
}

private final class FontURLSessionClient: NSObject, FontHTTPClient, URLSessionTaskDelegate {
    func get(_ url: URL, maximumBytes: Int) async throws -> FontHTTPResponse {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", forHTTPHeaderField: "User-Agent")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, let finalURL = http.url else {
            throw NoteFontError(message: "Font server returned an invalid response.")
        }
        if let contentLength = http.value(forHTTPHeaderField: "Content-Length").flatMap(Int.init), contentLength > maximumBytes {
            throw NoteFontError(message: "Font server response exceeds the download limit.")
        }
        var data = Data()
        for try await byte in bytes {
            guard data.count < maximumBytes else { throw NoteFontError(message: "Font server response exceeds the download limit.") }
            data.append(byte)
        }
        return FontHTTPResponse(data: data, statusCode: http.statusCode, finalURL: finalURL)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url, NoteFontStore.isAllowedCSSURL(url) || NoteFontStore.isAllowedFontURL(url) else {
            completionHandler(nil); return
        }
        var clean = request
        clean.httpShouldHandleCookies = false
        clean.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", forHTTPHeaderField: "User-Agent")
        completionHandler(clean)
    }
}

struct NoteFontStore {
    static let maximumCSSBytes = 2 * 1024 * 1024
    static let maximumFontBytes = 8 * 1024 * 1024
    static let maximumFamilyBytes = 100 * 1024 * 1024
    static let maximumFaces = 512
    private static let selectionKey = "foldnote.noteFont.selection"
    private static let manifestName = "manifest.json"

    private struct Face: Codable {
        let url: String
        let weight: String
        let unicodeRange: String?
        let file: String
    }
    private struct Font: Codable {
        let id: String
        let name: String
        let family: String
        let faces: [Face]
    }
    private struct Manifest: Codable { var fonts: [Font] }
    private struct ParsedFace { let url: URL; let weight: String; let unicodeRange: String? }

    let directory: URL
    private let defaults: any PreferencesStore
    private let client: FontHTTPClient
    private let fm = FileManager.default
    private var root: URL { directory.appendingPathComponent("fonts", isDirectory: true) }
    private var manifestURL: URL { root.appendingPathComponent(Self.manifestName) }

    init(directory: URL, defaults: any PreferencesStore = UserDefaults.standard, client: FontHTTPClient? = nil) {
        self.directory = directory.standardizedFileURL
        self.defaults = defaults
        self.client = client ?? FontURLSessionClient()
    }

    var state: [String: Any] {
        let selection = readSelection()
        var result: [String: Any] = ["selection": selection, "fonts": Self.builtins.map { Self.bridgeFont($0) }]
        do {
            for font in try loadManifest().fonts.sorted(by: { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }) {
                result["fonts"] = (result["fonts"] as! [[String: Any]]) + [Self.bridgeFont(font)]
            }
        } catch { result["warning"] = "Downloaded fonts are unavailable. Built-in fonts remain available." }
        return result
    }

    func select(_ value: Any?) throws -> [String: Any] {
        guard let object = value as? [String: Any], let id = object["fontID"] as? String,
              let number = object["weight"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue == Double(number.intValue),
              let weight = Int(exactly: number.intValue), [400, 500, 600].contains(weight),
              let font = knownFont(id: id), Self.supportedWeights(font).contains(weight) else { throw NoteFontError(message: "Choose an available font and weight 400, 500, or 600.") }
        defaults.set(["fontID": id, "weight": weight], forKey: Self.selectionKey)
        return state
    }

    func download(family: String) async throws -> [String: Any] {
        try Task.checkCancellation()
        guard Self.validFamily(family) else { throw NoteFontError(message: "Font family contains unsupported characters.") }
        let id = "google-" + Self.sha256(Data(family.lowercased().utf8))
        let cached: Manifest
        do { cached = try loadManifest() }
        catch { throw NoteFontError(message: "The font cache is invalid. Built-in fonts remain available; reset the fonts folder in the data folder before downloading again.") }
        if let font = cached.fonts.first(where: { $0.id == id }), (try? validateCachedFiles(font)) != nil {
            return ["fontState": state, "downloadedFontID": id]
        }
        let cssURL = Self.cssURL(family)
        let cssResponse = try await client.get(cssURL, maximumBytes: Self.maximumCSSBytes)
        try Task.checkCancellation()
        guard Self.isAllowedCSSURL(cssResponse.finalURL) else { throw NoteFontError(message: "Google Fonts returned an unsupported redirect.") }
        guard cssResponse.statusCode == 200 else { throw NoteFontError(message: "Google Fonts could not provide this family. Check the family name and try again.") }
        guard cssResponse.data.count <= Self.maximumCSSBytes, let css = String(data: cssResponse.data, encoding: .utf8) else { throw NoteFontError(message: "Google Fonts returned an invalid stylesheet.") }
        let parsed = try Self.parseCSS(css)
        guard !parsed.isEmpty, parsed.count <= Self.maximumFaces else { throw NoteFontError(message: "Font family has too many faces (maximum \(Self.maximumFaces)).") }
        let uniqueURLs = Array(Set(parsed.map { $0.url.absoluteString })).sorted()
        guard uniqueURLs.count <= Self.maximumFaces else { throw NoteFontError(message: "Font family has too many font files.") }
        let stagingName = ".stage-\(UUID().uuidString.lowercased())"
        try ensureRoot()
        let staging = root.appendingPathComponent(stagingName, isDirectory: true)
        try fm.createDirectory(at: staging, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        var staged: [String: String] = [:]
        var total = 0
        do {
            for rawURL in uniqueURLs {
                try Task.checkCancellation()
                guard let url = URL(string: rawURL), Self.isAllowedFontURL(url) else { throw NoteFontError(message: "Google Fonts CSS referenced a disallowed font URL.") }
                let response = try await client.get(url, maximumBytes: Self.maximumFontBytes)
                try Task.checkCancellation()
                guard response.statusCode == 200, Self.isAllowedFontURL(response.finalURL), response.data.count <= Self.maximumFontBytes else {
                    throw NoteFontError(message: "Google Fonts returned a disallowed redirect or oversized font file.")
                }
                try Self.validateWOFF2(response.data)
                total += response.data.count
                guard total <= Self.maximumFamilyBytes else { throw NoteFontError(message: "Font family exceeds the 100 MiB download limit.") }
                let filename = Self.sha256(Data(rawURL.utf8)) + ".woff2"
                try DurableFileWriter.write(response.data, replacing: staging.appendingPathComponent(filename))
                staged[rawURL] = filename
            }
            try Task.checkCancellation()
            let faces = parsed.map { Face(url: $0.url.absoluteString, weight: $0.weight, unicodeRange: $0.unicodeRange, file: staged[$0.url.absoluteString]!) }
            let font = Font(id: id, name: family, family: "foldnote-font-\(String(id.dropFirst(7)))", faces: faces)
            let finalDir = root.appendingPathComponent(id, isDirectory: true)
            let backupDir = root.appendingPathComponent(".backup-\(UUID().uuidString)", isDirectory: true)
            let hadPrevious = fm.fileExists(atPath: finalDir.path)
            if hadPrevious { try fm.moveItem(at: finalDir, to: backupDir) }
            do {
                try fm.moveItem(at: staging, to: finalDir)
                var manifest = try loadManifest()
                manifest.fonts.removeAll { $0.id == id }
                manifest.fonts.append(font)
                try persist(manifest)
                if hadPrevious { try? fm.removeItem(at: backupDir) }
            } catch {
                try? fm.removeItem(at: finalDir)
                if hadPrevious { try? fm.moveItem(at: backupDir, to: finalDir) }
                throw error
            }
            return ["fontState": state, "downloadedFontID": id]
        } catch {
            try? fm.removeItem(at: staging)
            throw error
        }
    }

    func resolveFontURL(_ url: URL) throws -> URL {
        guard url.scheme == "foldnote-font", url.host == "cache", url.user == nil, url.password == nil, url.port == nil,
              url.query == nil, url.fragment == nil,
              url.path.range(of: "^/[0-9a-f]{64}\\.woff2$", options: .regularExpression) != nil else {
            throw NoteFontError(message: "Invalid cached font URL.")
        }
        let filename = String(url.path.dropFirst())
        let manifest = try loadManifest()
        for font in manifest.fonts {
            guard font.faces.contains(where: { $0.file == filename }) else { continue }
            let dir = root.appendingPathComponent(font.id, isDirectory: true)
            try verifyRealDirectory(root)
            try verifyRealDirectory(dir)
            let file = dir.appendingPathComponent(filename).standardizedFileURL
            guard file.deletingLastPathComponent() == dir.standardizedFileURL else { break }
            let attrs = try fm.attributesOfItem(atPath: file.path)
            let values = try file.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey])
            guard attrs[.type] as? FileAttributeType == .typeRegular, (attrs[.size] as? NSNumber)?.intValue ?? Int.max <= Self.maximumFontBytes,
                  values.isRegularFile == true, values.isSymbolicLink != true,
                  file.resolvingSymlinksInPath().deletingLastPathComponent().standardizedFileURL == dir.resolvingSymlinksInPath().standardizedFileURL else { break }
            try Self.validateWOFF2(Data(contentsOf: file, options: [.mappedIfSafe]))
            return file
        }
        throw NoteFontError(message: "Cached font is unavailable.")
    }

    func exportCSS(fontSize: Int) -> String {
        let selected = readSelection()
        let font = knownFont(id: selected["fontID"] as! String) ?? Self.builtins[0]
        let size = min(72, max(8, fontSize))
        let faces = font.faces.map { face -> String in
            var declaration = "@font-face{font-family:'\(font.family)';font-style:normal;font-weight:\(face.weight);src:url('foldnote-font://cache/\(face.file)') format('woff2');font-display:swap;"
            if let range = face.unicodeRange { declaration += "unicode-range:\(range);" }
            return declaration + "}"
        }
        let family = font.id.hasPrefix("google-") ? "\(font.family),ui-monospace,Menlo,monospace" : font.family
        return faces.joined() + ".content{font-family:\(family);font-weight:\(selected["weight"] as! Int);font-size:\(size)px;font-synthesis:weight style}.content strong,.content h1,.content h2,.content h3,.content h4,.content h5,.content h6{font-weight:700}"
    }

    static func isAllowedCSSURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.host?.lowercased() == "fonts.googleapis.com" && url.path == "/css2" && url.user == nil && url.password == nil && url.port == nil
    }

    static func isAllowedFontURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.host?.lowercased() == "fonts.gstatic.com" && url.user == nil && url.password == nil && url.port == nil && url.path.range(of: "^/s/[A-Za-z0-9._-]+/v[0-9]+/[A-Za-z0-9._-]+\\.woff2$", options: .regularExpression) != nil
    }

    private static let builtins: [Font] = [
        Font(id: "sf-mono", name: "SF Mono", family: "ui-monospace, \"SFMono-Regular\", Menlo, monospace", faces: []),
        Font(id: "system", name: "System", family: "-apple-system, BlinkMacSystemFont, sans-serif", faces: []),
        Font(id: "avenir", name: "Avenir Next", family: "\"Avenir Next\", -apple-system, sans-serif", faces: []),
        Font(id: "georgia", name: "Georgia", family: "Georgia, serif", faces: [])
    ]

    private static func bridgeFont(_ font: Font) -> [String: Any] {
        let google = font.id.hasPrefix("google-")
        let supported = Set(supportedWeights(font))
        return ["id": font.id, "name": font.name, "kind": google ? "google" : "system", "family": font.family,
                "weights": [400, 500, 600].filter { supported.contains($0) },
                "faces": font.faces.map { face -> [String: Any] in
                    var item: [String: Any] = ["url": "foldnote-font://cache/\(face.file)", "weight": face.weight]
                    if let range = face.unicodeRange { item["unicodeRange"] = range }
                    return item
                }]
    }

    private func readSelection() -> [String: Any] {
        if let stored = defaults.dictionary(forKey: Self.selectionKey), let id = stored["fontID"] as? String,
           let weight = stored["weight"] as? Int, let font = knownFont(id: id), Self.supportedWeights(font).contains(weight) {
            return ["fontID": id, "weight": weight]
        }
        return ["fontID": "sf-mono", "weight": 500]
    }

    private func knownFont(id: String) -> Font? {
        if let builtin = Self.builtins.first(where: { $0.id == id }) { return builtin }
        return (try? loadManifest().fonts.first { $0.id == id })
    }

    private static func supportedWeights(_ font: Font) -> [Int] {
        if font.id == "georgia" { return [400] }
        guard font.id.hasPrefix("google-") else { return [400, 500, 600] }
        return Set(font.faces.flatMap { face -> [Int] in
            let parts = face.weight.split(separator: " ").compactMap { Int($0) }
            guard let low = parts.first else { return [] }
            let high = parts.last ?? low
            return [400, 500, 600].filter { $0 >= low && $0 <= high }
        }).sorted()
    }

    private func loadManifest() throws -> Manifest {
        guard fm.fileExists(atPath: root.path) else { return Manifest(fonts: []) }
        try verifyRealDirectory(root)
        guard fm.fileExists(atPath: manifestURL.path) else { return Manifest(fonts: []) }
        let values = try manifestURL.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey, .fileSizeKey])
        guard values.isSymbolicLink != true, values.isRegularFile == true, (values.fileSize ?? Int.max) <= 4 * 1024 * 1024 else { throw NoteFontError(message: "Font cache manifest is invalid.") }
        let data = try Data(contentsOf: manifestURL)
        guard data.count <= 4 * 1024 * 1024 else { throw NoteFontError(message: "Font cache manifest is too large.") }
        let manifest = try JSONDecoder().decode(Manifest.self, from: data)
        guard manifest.fonts.allSatisfy({ font in
            font.id.range(of: "^google-[0-9a-f]{64}$", options: .regularExpression) != nil && Self.validFamily(font.name) &&
            font.family == "foldnote-font-\(font.id.dropFirst(7))" && !font.faces.isEmpty && font.faces.count <= Self.maximumFaces && !Self.supportedWeights(font).isEmpty &&
            font.faces.allSatisfy { face in
                face.file.range(of: "^[0-9a-f]{64}\\.woff2$", options: .regularExpression) != nil &&
                Self.validWeightDescriptor(face.weight) &&
                URL(string: face.url).map(Self.isAllowedFontURL) == true &&
                (face.unicodeRange == nil || face.unicodeRange!.range(of: "^[Uu]\\+[0-9A-Fa-f?,-]+(?:\\s*,\\s*[Uu]\\+[0-9A-Fa-f?,-]+)*$", options: .regularExpression) != nil)
            }
        }) else {
            throw NoteFontError(message: "Font cache manifest is corrupt.")
        }
        return manifest
    }

    private func validateCachedFiles(_ font: Font) throws {
        for face in font.faces { _ = try resolveFontURL(URL(string: "foldnote-font://cache/\(face.file)")!) }
    }

    private func persist(_ manifest: Manifest) throws {
        let data = try JSONEncoder().encode(manifest)
        try DurableFileWriter.write(data, replacing: manifestURL)
    }

    private func ensureRoot() throws {
        try DurableFileWriter.prepareDirectory(directory)
        let parentValues = try directory.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
        guard parentValues.isSymbolicLink != true, parentValues.isDirectory == true else { throw NoteFontError(message: "Font data directory must be a real directory.") }
        try DurableFileWriter.prepareDirectory(root)
        try verifyRealDirectory(root)
    }

    private func verifyRealDirectory(_ url: URL) throws {
        let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
        guard values.isSymbolicLink != true, values.isDirectory == true else { throw NoteFontError(message: "Font cache contains an unsafe directory.") }
    }

    private static func validFamily(_ family: String) -> Bool {
        !family.isEmpty && family.utf8.count <= 120 && family.range(of: "^[A-Za-z0-9][A-Za-z0-9 '.-]*$", options: .regularExpression) != nil
    }

    private static func cssURL(_ family: String) -> URL {
        var components = URLComponents(string: "https://fonts.googleapis.com/css2")!
        components.queryItems = [URLQueryItem(name: "family", value: family + ":wght@400;500;600;700"), URLQueryItem(name: "display", value: "swap")]
        return components.url!
    }

    private static func parseCSS(_ rawCSS: String) throws -> [ParsedFace] {
        guard rawCSS.utf8.count <= maximumCSSBytes else { throw NoteFontError(message: "Google Fonts CSS is too large.") }
        let css = rawCSS.replacingOccurrences(of: #"/\*[\s\S]*?\*/"#, with: "", options: .regularExpression)
        guard !css.lowercased().contains("@import") else { throw NoteFontError(message: "Google Fonts CSS contains unsupported content.") }
        let blockPattern = "@font-face\\s*\\{([^{}]*)\\}"
        let regex = try NSRegularExpression(pattern: blockPattern, options: [.caseInsensitive])
        let source = css as NSString
        let matches = regex.matches(in: css, range: NSRange(location: 0, length: source.length))
        guard matches.count <= maximumFaces else { throw NoteFontError(message: "Font family has too many faces (maximum \(maximumFaces)).") }
        var faces: [ParsedFace] = []
        for match in matches {
            let block = source.substring(with: match.range(at: 1))
            guard let weight = descriptor("font-weight", in: block), validWeightDescriptor(weight),
                  let src = descriptor("src", in: block), let urlText = fontSource(src),
                  let url = URL(string: urlText), isAllowedFontURL(url) else { throw NoteFontError(message: "Google Fonts CSS contains an unsupported font face.") }
            if let style = descriptor("font-style", in: block), style.lowercased() != "normal" { continue }
            let range = descriptor("unicode-range", in: block)
            if let range, range.range(of: "^[Uu]\\+[0-9A-Fa-f?,-]+(?:\\s*,\\s*[Uu]\\+[0-9A-Fa-f?,-]+)*$", options: .regularExpression) == nil {
                throw NoteFontError(message: "Google Fonts CSS contains an invalid unicode range.")
            }
            faces.append(ParsedFace(url: url, weight: weight, unicodeRange: range))
        }
        guard !faces.isEmpty, css.replacingOccurrences(of: blockPattern, with: "", options: [.regularExpression, .caseInsensitive]).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw NoteFontError(message: "Google Fonts CSS contains unsupported content or no normal faces.")
        }
        return faces
    }

    private static func validWeightDescriptor(_ value: String) -> Bool {
        guard value.range(of: "^(400|500|600|700)(\\s+(400|500|600|700))?$", options: .regularExpression) != nil else { return false }
        let weights = value.split(whereSeparator: { $0.isWhitespace }).compactMap { Int($0) }
        return weights.first! <= weights.last!
    }

    private static func fontSource(_ source: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: #"url\(\s*(['"]?)(https://[^)'"\s]+)\1\s*\)"#, options: .caseInsensitive),
              let match = regex.firstMatch(in: source, range: NSRange(source.startIndex..., in: source)),
              let range = Range(match.range(at: 2), in: source) else { return nil }
        return String(source[range])
    }

    private static func descriptor(_ name: String, in block: String) -> String? {
        let escaped = NSRegularExpression.escapedPattern(for: name)
        guard let regex = try? NSRegularExpression(pattern: "(?:^|;)\\s*\(escaped)\\s*:\\s*([^;]+)", options: [.caseInsensitive]),
              let match = regex.firstMatch(in: block, range: NSRange(block.startIndex..., in: block)),
              let range = Range(match.range(at: 1), in: block) else { return nil }
        return String(block[range]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func validateWOFF2(_ data: Data) throws {
        guard data.count >= 48, data.prefix(4).elementsEqual([UInt8]("wOF2".utf8)) else { throw NoteFontError(message: "Downloaded font is not a valid WOFF2 file.") }
        func uint32(_ offset: Int) -> Int { Int(data[offset]) << 24 | Int(data[offset + 1]) << 16 | Int(data[offset + 2]) << 8 | Int(data[offset + 3]) }
        let declared = uint32(8)
        let tables = Int(data[12]) << 8 | Int(data[13])
        let sfntSize = uint32(16)
        let compressedSize = uint32(20)
        let metadataOffset = uint32(28), metadataLength = uint32(32), metadataOriginal = uint32(36)
        let privateOffset = uint32(40), privateLength = uint32(44)
        guard declared == data.count, tables > 0, tables <= 4096, sfntSize > 0, sfntSize <= 64 * 1024 * 1024,
              data[14] == 0, data[15] == 0, compressedSize > 0, compressedSize <= data.count - 48,
              (metadataLength == 0 ? metadataOffset == 0 && metadataOriginal == 0 : metadataOffset >= 48 && metadataOriginal > 0 && metadataOriginal <= 64 * 1024 * 1024 && metadataOffset <= data.count && metadataLength <= data.count - metadataOffset),
              (privateLength == 0 ? privateOffset == 0 : privateOffset >= 48 && privateOffset <= data.count && privateLength <= data.count - privateOffset) else {
            throw NoteFontError(message: "Downloaded WOFF2 declared lengths or table count are invalid.")
        }
    }

    private static func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
}
