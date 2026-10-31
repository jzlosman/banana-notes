import AppKit
import UniformTypeIdentifiers

@MainActor
final class SystemViewerLaunchServices: ViewerLaunchServices {
    var viewerBundleIdentifier: ViewerBundleIdentifier? { ViewerBundleIdentifier(Bundle.main.bundleIdentifier) }

    var markdownContentTypeIdentifiers: [String] {
        ViewerDefaultApplicationDecision.contentTypeIdentifiers(
            markdownTypeIdentifier: UTType("net.daringfireball.markdown")?.identifier,
            mdExtensionTypeIdentifier: UTType(filenameExtension: "md")?.identifier)
    }

    func currentApplication(forContentTypeIdentifier identifier: String) -> ViewerDefaultApplication? {
        guard let contentType = UTType(identifier),
              let applicationURL = NSWorkspace.shared.urlForApplication(toOpen: contentType) else { return nil }
        return application(at: applicationURL)
    }

    func application(forBundleIdentifier identifier: ViewerBundleIdentifier) -> ViewerDefaultApplication? {
        guard let applicationURL = applicationURL(for: identifier) else { return nil }
        return application(at: applicationURL, matching: identifier)
    }

    func setDefaultApplication(bundleIdentifier identifier: ViewerBundleIdentifier,
                               forContentTypeIdentifier contentTypeIdentifier: String) async -> Bool {
        guard let contentType = UTType(contentTypeIdentifier),
              let applicationURL = applicationURL(for: identifier) else { return false }
        return await withCheckedContinuation { continuation in
            NSWorkspace.shared.setDefaultApplication(at: applicationURL, toOpen: contentType) { error in
                continuation.resume(returning: error == nil)
            }
        }
    }

    private func applicationURL(for identifier: ViewerBundleIdentifier) -> URL? {
        if identifier == viewerBundleIdentifier { return Bundle.main.bundleURL }
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: identifier.rawValue),
              let bundle = Bundle(url: url),
              ViewerBundleIdentifier(bundle.bundleIdentifier) == identifier else { return nil }
        return url
    }

    private func application(at url: URL, matching identifier: ViewerBundleIdentifier? = nil) -> ViewerDefaultApplication? {
        let bundle = Bundle(url: url)
        let bundleIdentifier = ViewerBundleIdentifier(bundle?.bundleIdentifier)
        guard identifier == nil || bundleIdentifier == identifier else { return nil }
        let displayName = ViewerDefaultApplicationDecision.applicationName(
            displayName: bundle?.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String,
            bundleName: bundle?.object(forInfoDictionaryKey: "CFBundleName") as? String)
        return ViewerDefaultApplication(bundleIdentifier: bundleIdentifier, displayName: displayName)
    }
}
