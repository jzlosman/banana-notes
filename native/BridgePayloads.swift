import Foundation

struct BridgeRect: Decodable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    func isValid(in size: CGSize) -> Bool {
        [x, y, width, height].allSatisfy(\.isFinite) && width > 0 && height > 0 && x >= 0 && y >= 0 &&
            x + width <= size.width && y + height <= size.height
    }
}

struct ClipboardPayload: Decodable, Equatable {
    let text: String
    let html: String?
    let markdown: String?

    private enum CodingKeys: String, CodingKey { case text, html, markdown }

    init(text: String, html: String? = nil, markdown: String? = nil) throws {
        guard text.utf8.count + (html?.utf8.count ?? 0) + (markdown?.utf8.count ?? 0) <= 10_000_000 else {
            throw StoreError(message: "This clipboard content is too large.")
        }
        self.text = text
        self.html = html
        self.markdown = markdown
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        text = try container.decode(String.self, forKey: .text)
        html = container.contains(.html) ? try container.decode(String.self, forKey: .html) : nil
        markdown = container.contains(.markdown) ? try container.decode(String.self, forKey: .markdown) : nil
        guard text.utf8.count + (html?.utf8.count ?? 0) + (markdown?.utf8.count ?? 0) <= 10_000_000 else {
            throw StoreError(message: "This clipboard content is too large.")
        }
    }
}

struct StartupPreferencesPatch: Decodable, Equatable {
    let launchAtLogin: Bool?
    let newNoteOnLaunch: Bool?

    private enum CodingKeys: String, CodingKey { case launchAtLogin, newNoteOnLaunch }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        launchAtLogin = container.contains(.launchAtLogin) ? try container.decode(Bool.self, forKey: .launchAtLogin) : nil
        newNoteOnLaunch = container.contains(.newNoteOnLaunch) ? try container.decode(Bool.self, forKey: .newNoteOnLaunch) : nil
        guard launchAtLogin != nil || newNoteOnLaunch != nil else {
            throw StoreError(message: "Choose a startup preference to update.")
        }
    }
}

struct ImageExportPreferences: Decodable, Equatable {
    enum Gradient: String, Decodable { case dawn, lavender, ocean }
    let gradient: Gradient
    let width: Int
    let padding: Int

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        gradient = try container.decode(Gradient.self, forKey: .gradient)
        width = try container.decode(Int.self, forKey: .width)
        padding = try container.decode(Int.self, forKey: .padding)
        guard (480...1200).contains(width), (24...120).contains(padding), width > padding * 2 else {
            throw StoreError(message: "Choose a supported image style, width and padding.")
        }
    }

    private enum CodingKeys: String, CodingKey { case gradient, width, padding }
    var storedValue: [String: Any] { ["gradient": gradient.rawValue, "width": width, "padding": padding] }
}

struct MarkdownExportNote: Decodable, Equatable {
    let id: String
    let title: String?
    let markdown: String

    private enum CodingKeys: String, CodingKey { case id, title, markdown }
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = container.contains(.title) ? try container.decode(String.self, forKey: .title) : nil
        markdown = try container.decode(String.self, forKey: .markdown)
        guard !id.isEmpty, id.utf8.count <= 512, (title?.utf8.count ?? 0) <= 500,
              markdown.utf8.count <= LibraryStore.maximumNoteBytes else {
            throw StoreError(message: "Each exported note must have a valid identity, title and Markdown value.")
        }
    }
}

struct AttachmentImportRequest: Decodable, Equatable {
    let name: String
    let mimeType: String
    let dataBase64: String

    private enum CodingKeys: String, CodingKey { case name, mimeType, dataBase64 }
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        mimeType = try container.decode(String.self, forKey: .mimeType)
        dataBase64 = try container.decode(String.self, forKey: .dataBase64)
        guard !name.isEmpty, !mimeType.isEmpty,
              dataBase64.utf8.count <= ((AttachmentStore.maximumBytes + 2) / 3) * 4 + 8 else {
            throw StoreError(message: "Attachment name, type and data are required; data must not exceed 50 MiB.")
        }
    }
}

struct AttachmentURLRequest: Decodable, Equatable {
    let url: URL
    private enum CodingKeys: String, CodingKey { case url }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try container.decode(String.self, forKey: .url)
        guard let parsed = URL(string: raw), parsed.scheme != nil else { throw StoreError(message: "Select a valid attachment.") }
        url = parsed
    }
}

struct NoteFontSelection: Decodable, Equatable {
    let fontID: String
    let weight: Int

    private enum CodingKeys: String, CodingKey { case fontID, weight }
    init(fontID: String, weight: Int) throws {
        guard !fontID.isEmpty, fontID.utf8.count <= 128, [400, 500, 600].contains(weight) else {
            throw NoteFontError(message: "Choose an available font and weight 400, 500, or 600.")
        }
        self.fontID = fontID
        self.weight = weight
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(fontID: container.decode(String.self, forKey: .fontID), weight: container.decode(Int.self, forKey: .weight))
    }
}

struct HotkeyShortcutPayload: Decodable {
    let chord: HotkeyChord
    private enum CodingKeys: String, CodingKey { case keyCode, modifiers }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let keyCode = try container.decode(UInt32.self, forKey: .keyCode)
        let modifiers = try container.decode(UInt32.self, forKey: .modifiers)
        do { chord = try HotkeyChord(keyCode: keyCode, modifiers: modifiers) }
        catch { throw StoreError(message: error.localizedDescription) }
    }
}
