import Foundation

struct ViewerRasterPath {
    let components: [String]
    let mimeType: String

    fileprivate init(components: [String], mimeType: String) {
        self.components = components
        self.mimeType = mimeType
    }
}

enum ViewerPolicy {
    static let resourceBaseURL = "banana-viewer-resource://document/"
    static let imageMIMETypes: [String: String] = [
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp"
    ]

    static func validateWirePreferences(_ value: Any, catalog: ViewerCatalog) throws -> ViewerPreferences {
        guard let dictionary = value as? [String: Any], Set(dictionary.keys) == ViewerPreferences.wireKeys else {
            throw ViewerError.invalidPreferences("Preferences must contain exactly the supported viewer settings.")
        }
        let data: Data
        do { data = try JSONSerialization.data(withJSONObject: dictionary) }
        catch { throw ViewerError.invalidPreferences("Preferences are malformed.") }
        let preferences: ViewerPreferences
        do { preferences = try JSONDecoder().decode(ViewerPreferences.self, from: data) }
        catch { throw ViewerError.invalidPreferences("Preferences are malformed.") }
        try preferences.validate(using: catalog)
        return preferences
    }

    static func rasterPath(requestURL: URL) throws -> ViewerRasterPath {
        guard requestURL.scheme?.lowercased() == "banana-viewer-resource",
              requestURL.host?.lowercased() == "document",
              requestURL.query == nil, requestURL.fragment == nil else { throw ViewerError.invalidResource }
        let components = URLComponents(url: requestURL, resolvingAgainstBaseURL: false)
        guard let encodedPath = components?.percentEncodedPath,
              let decodedPath = encodedPath.removingPercentEncoding,
              !decodedPath.contains("\\"), !decodedPath.contains("\0") else { throw ViewerError.invalidResource }
        let relative = decodedPath.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
        guard !relative.isEmpty, relative.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw ViewerError.invalidResource
        }
        let pathComponents = relative.map(String.init)
        let ext = URL(fileURLWithPath: pathComponents.last!).pathExtension.lowercased()
        guard let mimeType = imageMIMETypes[ext] else { throw ViewerError.invalidResource }
        return ViewerRasterPath(components: pathComponents, mimeType: mimeType)
    }

    static func localMarkdownTarget(href: String, relativeTo sourceURL: URL) -> URL? {
        guard !href.isEmpty, !href.contains("\\"), !href.contains("\0"),
              let components = URLComponents(string: href), components.scheme == nil,
              components.host == nil, components.query == nil,
              !components.path.isEmpty, !components.path.hasPrefix("/") else { return nil }
        let target = URL(fileURLWithPath: components.path, relativeTo: sourceURL.deletingLastPathComponent())
            .standardizedFileURL
        guard ViewerDocumentReader.supportedExtensions.contains(target.pathExtension.lowercased()) else { return nil }
        return target
    }

    static func explicitExternalURL(_ href: String) -> URL? {
        guard let url = URL(string: href), let scheme = url.scheme?.lowercased() else { return nil }
        switch scheme {
        case "http", "https":
            guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  let host = components.host, !host.isEmpty,
                  components.user == nil, components.password == nil else { return nil }
            return url
        case "mailto":
            let afterScheme = url.absoluteString.drop { $0 != ":" }.dropFirst()
            let address = afterScheme.prefix { $0 != "?" }.removingPercentEncoding ?? ""
            return address.contains("@") ? url : nil
        default: return nil
        }
    }
}
