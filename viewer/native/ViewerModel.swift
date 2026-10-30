import Foundation

struct ViewerPreferences: Codable, Equatable {
    let themeID: String
    let syntaxThemeID: String
    let fontID: String
    let fontWeight: Int
    let fontSize: Int
    let focusedOpacity: Double
    let unfocusedOpacity: Double
    let glass: Double

    static let defaults = ViewerPreferences(
        themeID: "system", syntaxThemeID: "app", fontID: "space-mono", fontWeight: 400,
        fontSize: 15, focusedOpacity: 1, unfocusedOpacity: 1, glass: 0)

    static let wireKeys: Set<String> = [
        "themeID", "syntaxThemeID", "fontID", "fontWeight", "fontSize",
        "focusedOpacity", "unfocusedOpacity", "glass"
    ]

    func validate(using catalog: ViewerCatalog) throws {
        guard themeID == "system" || catalog.themeIDs.contains(themeID) else {
            throw ViewerError.invalidPreferences("Unknown appearance theme.")
        }
        guard syntaxThemeID == "app" || catalog.themeIDs.contains(syntaxThemeID) else {
            throw ViewerError.invalidPreferences("Unknown code theme.")
        }
        guard let weights = catalog.fontWeights[fontID], weights.contains(fontWeight) else {
            throw ViewerError.invalidPreferences("The selected font or weight is unavailable.")
        }
        guard (10...32).contains(fontSize) else {
            throw ViewerError.invalidPreferences("Text size must be between 10 and 32 points.")
        }
        guard focusedOpacity.isFinite, (0.05...1).contains(focusedOpacity),
              unfocusedOpacity.isFinite, (0.05...1).contains(unfocusedOpacity),
              glass.isFinite, (0...1).contains(glass) else {
            throw ViewerError.invalidPreferences("Window effects are outside the supported range.")
        }
    }
}

struct ViewerWindowSurfacePlan: Equatable {
    let paperAlpha: Double
    let vibrancyAlpha: Double
    let showsVibrancy: Bool
    let windowIsOpaque: Bool
    let foregroundAlpha: Double

    static func make(preferences: ViewerPreferences, isFocused: Bool) -> ViewerWindowSurfacePlan {
        let glass = preferences.glass.isFinite ? min(1, max(0, preferences.glass)) : 0
        return ViewerWindowSurfacePlan(
            paperAlpha: 1 - glass,
            vibrancyAlpha: glass,
            showsVibrancy: glass > 0,
            windowIsOpaque: glass == 0,
            foregroundAlpha: isFocused ? preferences.focusedOpacity : preferences.unfocusedOpacity)
    }
}

struct ViewerSnapshot: Encodable, Equatable {
    let document: ViewerDocument
    let preferences: ViewerPreferences
}

enum ViewerDocument: Encodable, Equatable {
    case empty
    case loaded(documentID: String, name: String, markdown: String, revision: String, resourceBaseURL: String)
    case error(name: String, message: String)

    private enum CodingKeys: String, CodingKey { case kind, documentID, name, markdown, revision, resourceBaseURL, message }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .empty:
            try container.encode("empty", forKey: .kind)
        case let .loaded(documentID, name, markdown, revision, resourceBaseURL):
            try container.encode("loaded", forKey: .kind)
            try container.encode(documentID, forKey: .documentID)
            try container.encode(name, forKey: .name)
            try container.encode(markdown, forKey: .markdown)
            try container.encode(revision, forKey: .revision)
            try container.encode(resourceBaseURL, forKey: .resourceBaseURL)
        case let .error(name, message):
            try container.encode("error", forKey: .kind)
            try container.encode(name, forKey: .name)
            try container.encode(message, forKey: .message)
        }
    }
}

enum ViewerError: LocalizedError, Equatable {
    case unsupportedFile
    case directory
    case tooLarge
    case invalidUTF8
    case unavailable
    case invalidPreferences(String)
    case invalidResource

    var errorDescription: String? {
        switch self {
        case .unsupportedFile: return "Choose a Markdown document (.md, .markdown, .mdown, or .mkd)."
        case .directory: return "Folders cannot be opened as Markdown documents."
        case .tooLarge: return "This Markdown document is larger than the 8 MB viewer limit."
        case .invalidUTF8: return "This document is not valid UTF-8 text."
        case .unavailable: return "This document is unavailable or could not be read."
        case .invalidPreferences(let message): return message
        case .invalidResource: return "This image is unavailable or is not a supported local raster image."
        }
    }
}

struct ViewerCatalog {
    struct Theme: Decodable {
        struct Colors: Decodable { let paper: String }
        let id: String
        let appearance: String
        let colors: Colors
    }

    struct Font: Decodable {
        let id: String
        let kind: String
        let weights: [Int]
    }

    let themes: [String: Theme]
    let fontWeights: [String: Set<Int>]
    var themeIDs: Set<String> { Set(themes.keys) }

    init(themeData: Data, fontData: Data) throws {
        let themeRows = try JSONDecoder().decode([Theme].self, from: themeData)
        let fontRows = try JSONDecoder().decode([Font].self, from: fontData)
        var themeMap: [String: Theme] = [:]
        for theme in themeRows {
            guard Self.validID(theme.id), theme.id != "system", themeMap[theme.id] == nil,
                  ["light", "dark"].contains(theme.appearance),
                  theme.colors.paper.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil else {
                throw ViewerError.invalidPreferences("The bundled theme catalog is invalid.")
            }
            themeMap[theme.id] = theme
        }
        var weights: [String: Set<Int>] = [:]
        var allFontIDs = Set<String>()
        for font in fontRows {
            guard Self.validID(font.id), ["bundled", "system", "google"].contains(font.kind),
                  !font.weights.isEmpty, font.weights.allSatisfy({ (100...900).contains($0) }),
                  allFontIDs.insert(font.id).inserted else {
                throw ViewerError.invalidPreferences("The bundled font catalog is invalid.")
            }
            if ["bundled", "system"].contains(font.kind) { weights[font.id] = Set(font.weights) }
        }
        guard !themeMap.isEmpty, weights["space-mono"]?.contains(400) == true else {
            throw ViewerError.invalidPreferences("The bundled viewer catalogs are incomplete.")
        }
        themes = themeMap
        fontWeights = weights
    }

    private static func validID(_ value: String) -> Bool {
        value.range(of: "^[a-z0-9]+(?:-[a-z0-9]+)*$", options: .regularExpression) != nil
    }
}

func viewerFoundationValue<T: Encodable>(_ value: T) throws -> Any {
    let data = try JSONEncoder().encode(value)
    return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
}
