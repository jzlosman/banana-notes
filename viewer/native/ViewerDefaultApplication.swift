import Foundation

struct ViewerBundleIdentifier: Equatable, Hashable {
    let rawValue: String

    init?(_ value: String?) {
        guard let value, value.count <= 255, value.contains("."),
              !value.hasPrefix("."), !value.hasSuffix("."),
              value.split(separator: ".", omittingEmptySubsequences: false).allSatisfy({ component in
                  !component.isEmpty && component.utf8.allSatisfy { byte in
                      (65...90).contains(byte) || (97...122).contains(byte) || (48...57).contains(byte) || byte == 45
                  }
              }) else { return nil }
        rawValue = value
    }
}

struct ViewerDefaultApplication: Equatable {
    let bundleIdentifier: ViewerBundleIdentifier?
    let displayName: String?
}

struct ViewerDefaultAppStatus: Encodable, Equatable {
    let isViewerDefault: Bool
    let currentAppName: String?
    let canToggle: Bool
    let previousAppName: String?

    private enum CodingKeys: String, CodingKey { case isViewerDefault, currentAppName, canToggle, previousAppName }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(isViewerDefault, forKey: .isViewerDefault)
        if let currentAppName { try container.encode(currentAppName, forKey: .currentAppName) }
        else { try container.encodeNil(forKey: .currentAppName) }
        try container.encode(canToggle, forKey: .canToggle)
        if let previousAppName { try container.encode(previousAppName, forKey: .previousAppName) }
        else { try container.encodeNil(forKey: .previousAppName) }
    }
}

enum ViewerDefaultAppOutcome: String, Encodable, Equatable {
    case changed
    case declinedOrFailed
}

protocol ViewerDefaultApplicationMemory {
    var previousDefaultApplicationBundleIdentifier: ViewerBundleIdentifier? { get }
    func rememberPreviousDefaultApplication(_ identifier: ViewerBundleIdentifier?)
}

@MainActor
protocol ViewerLaunchServices {
    var viewerBundleIdentifier: ViewerBundleIdentifier? { get }
    var markdownContentTypeIdentifiers: [String] { get }
    func currentApplication(forContentTypeIdentifier identifier: String) -> ViewerDefaultApplication?
    func application(forBundleIdentifier identifier: ViewerBundleIdentifier) -> ViewerDefaultApplication?
    func setDefaultApplication(bundleIdentifier: ViewerBundleIdentifier, forContentTypeIdentifier identifier: String) async -> Bool
}

enum ViewerDefaultApplicationDecision {
    static func contentTypeIdentifiers(markdownTypeIdentifier: String?, mdExtensionTypeIdentifier: String?) -> [String] {
        var seen = Set<String>()
        return [markdownTypeIdentifier, mdExtensionTypeIdentifier].compactMap { identifier in
            guard let identifier, !identifier.isEmpty, identifier.count <= 255,
                  !identifier.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
                  seen.insert(identifier).inserted else { return nil }
            return identifier
        }
    }

    static func applicationName(displayName: String?, bundleName: String?) -> String? {
        [displayName, bundleName].compactMap { candidate in
            guard let candidate else { return nil }
            let name = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, name.count <= 256, !name.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) else { return nil }
            return name
        }.first
    }

    static func previousApplication(defaultApplications: [ViewerDefaultApplication?], viewerBundleIdentifier: ViewerBundleIdentifier?) -> ViewerDefaultApplication? {
        guard !defaultApplications.isEmpty,
              let first = defaultApplications[0],
              let identifier = first.bundleIdentifier,
              identifier != viewerBundleIdentifier,
              defaultApplications.allSatisfy({ $0?.bundleIdentifier == identifier }) else { return nil }
        return first
    }

    static func status(defaultApplications: [ViewerDefaultApplication?],
                       viewerBundleIdentifier: ViewerBundleIdentifier?,
                       previousApplication: ViewerDefaultApplication?,
                       canSetDefault: Bool) -> ViewerDefaultAppStatus {
        let isViewerDefault = !defaultApplications.isEmpty && viewerBundleIdentifier != nil &&
            defaultApplications.allSatisfy { $0?.bundleIdentifier == viewerBundleIdentifier }
        if isViewerDefault {
            return ViewerDefaultAppStatus(isViewerDefault: true, currentAppName: nil,
                                          canToggle: previousApplication != nil,
                                          previousAppName: previousApplication?.displayName)
        }
        let applications = defaultApplications.compactMap { $0 }
        let currentApp = applications.first { $0.bundleIdentifier != viewerBundleIdentifier && $0.displayName != nil }
            ?? applications.first { $0.displayName != nil }
        return ViewerDefaultAppStatus(isViewerDefault: false, currentAppName: currentApp?.displayName,
                                      canToggle: canSetDefault, previousAppName: nil)
    }
}

@MainActor
final class ViewerDefaultApplicationManager {
    private let launchServices: ViewerLaunchServices
    private let memory: ViewerDefaultApplicationMemory

    init(launchServices: ViewerLaunchServices, memory: ViewerDefaultApplicationMemory) {
        self.launchServices = launchServices
        self.memory = memory
    }

    func status() -> ViewerDefaultAppStatus {
        let identifiers = launchServices.markdownContentTypeIdentifiers
        let applications = identifiers.map { launchServices.currentApplication(forContentTypeIdentifier: $0) }
        let viewerBundleIdentifier = launchServices.viewerBundleIdentifier
        let isViewerDefault = !applications.isEmpty && viewerBundleIdentifier != nil &&
            applications.allSatisfy { $0?.bundleIdentifier == viewerBundleIdentifier }
        let previousApplication: ViewerDefaultApplication?
        if isViewerDefault, let previousIdentifier = memory.previousDefaultApplicationBundleIdentifier,
           previousIdentifier != viewerBundleIdentifier {
            previousApplication = launchServices.application(forBundleIdentifier: previousIdentifier)
        } else {
            previousApplication = nil
        }
        return ViewerDefaultApplicationDecision.status(defaultApplications: applications,
                                                       viewerBundleIdentifier: viewerBundleIdentifier,
                                                       previousApplication: previousApplication,
                                                       canSetDefault: !identifiers.isEmpty && viewerBundleIdentifier != nil)
    }

    func setDefault(enabled: Bool) async -> ViewerDefaultAppOutcome {
        let identifiers = launchServices.markdownContentTypeIdentifiers
        guard !identifiers.isEmpty, let viewerBundleIdentifier = launchServices.viewerBundleIdentifier else { return .declinedOrFailed }
        let currentStatus = status()

        if enabled {
            guard !currentStatus.isViewerDefault else { return .declinedOrFailed }
            if let remembered = memory.previousDefaultApplicationBundleIdentifier,
               launchServices.application(forBundleIdentifier: remembered) == nil {
                memory.rememberPreviousDefaultApplication(nil)
            }
            if memory.previousDefaultApplicationBundleIdentifier == nil,
               let previous = ViewerDefaultApplicationDecision.previousApplication(
                    defaultApplications: identifiers.map { launchServices.currentApplication(forContentTypeIdentifier: $0) },
                    viewerBundleIdentifier: viewerBundleIdentifier),
               let previousIdentifier = previous.bundleIdentifier {
                memory.rememberPreviousDefaultApplication(previousIdentifier)
            }

            var changedIdentifiers: [String] = []
            for identifier in identifiers {
                guard await launchServices.setDefaultApplication(bundleIdentifier: viewerBundleIdentifier,
                                                                  forContentTypeIdentifier: identifier) else {
                    if let previousIdentifier = memory.previousDefaultApplicationBundleIdentifier {
                        var restored = true
                        for changedIdentifier in changedIdentifiers.reversed() {
                            if !(await launchServices.setDefaultApplication(bundleIdentifier: previousIdentifier,
                                                                            forContentTypeIdentifier: changedIdentifier)) {
                                restored = false
                            }
                        }
                        if restored { memory.rememberPreviousDefaultApplication(nil) }
                    }
                    return .declinedOrFailed
                }
                changedIdentifiers.append(identifier)
            }
            return .changed
        }

        guard currentStatus.isViewerDefault, currentStatus.canToggle,
              let previousIdentifier = memory.previousDefaultApplicationBundleIdentifier,
              launchServices.application(forBundleIdentifier: previousIdentifier) != nil else { return .declinedOrFailed }
        for identifier in identifiers {
            guard await launchServices.setDefaultApplication(bundleIdentifier: previousIdentifier,
                                                              forContentTypeIdentifier: identifier) else { return .declinedOrFailed }
        }
        memory.rememberPreviousDefaultApplication(nil)
        return .changed
    }
}
