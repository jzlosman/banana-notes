import AppKit
import Foundation
import WebKit
import Darwin
@testable import BananaViewerCore

@main
@MainActor
struct ViewerWebKitSmokeTest {
    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            throw SmokeFailure.message("Usage: ViewerWebKitSmokeTest <Banana Viewer.app/Contents/Resources/web>")
        }
        let webDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("banana-viewer-smoke-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let first = root.appendingPathComponent("smoke.md")
        let image = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgV8AAAAASUVORK5CYII=")!
        try image.write(to: root.appendingPathComponent("smoke.png"))
        try writeAtomically(Data("# Viewer smoke initial\n\n![Local image](smoke.png)\n".utf8), to: first)
        let second = root.appendingPathComponent("second.md")
        try writeAtomically(Data("# Second window document\n".utf8), to: second)

        let suite = "com.jzlosman.banana-viewer.smoke.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            throw SmokeFailure.message("Could not create isolated viewer preference domain.")
        }
        defer { defaults.removePersistentDomain(forName: suite) }

        let application = NSApplication.shared
        application.setActivationPolicy(.regular)
        let launchServices = SmokeViewerLaunchServices()
        let runtime = try ViewerApplicationRuntime(webDirectory: webDirectory, defaults: defaults, launchServices: launchServices)
        defer { runtime.shutdown() }
        runtime.start(launchURLs: [first])
        guard let controller = runtime.controller(for: first) else {
            throw SmokeFailure.message("The first synthetic document did not open.")
        }
        controller.show()
        let webView = controller.webView!

        try wait(webView, timeout: 20, description: "viewer page load") {
            (try? evaluate(webView, "document.readyState === 'complete'")) as? Bool == true
        }
        try wait(webView, timeout: 20, description: "rendered initial Markdown") {
            (try? evaluate(webView, "(document.body?.innerText || '').includes('Viewer smoke initial')")) as? Bool == true
        }
        let transparentSurface = try evaluate(webView, "(() => { const nodes=[document.querySelector('.viewer-shell'),document.querySelector('.viewer-body')]; return nodes.every(node => !!node && getComputedStyle(node).backgroundColor.endsWith(', 0)')); })()") as? Bool == true
        guard transparentSurface else {
            let details = try evaluate(webView, "JSON.stringify({native:document.documentElement.dataset.native,shell:getComputedStyle(document.querySelector('.viewer-shell')).backgroundColor,body:getComputedStyle(document.querySelector('.viewer-body')).backgroundColor})") as? String ?? "unavailable"
            throw SmokeFailure.message("WebKit content surfaces are not transparent for native glass: \(details)")
        }
        try wait(webView, timeout: 20, description: "relative image load") {
            (try? evaluate(webView, "Array.from(document.images).some(image => image.complete && image.naturalWidth > 0)")) as? Bool == true
        }

        _ = try evaluate(webView, "window.__viewerSmokeResult=null; window.webkit.messageHandlers.viewer.postMessage({action:'bootstrap'}).then(value=>window.__viewerSmokeResult=value).catch(error=>window.__viewerSmokeResult={error:String(error)}); true")
        try wait(webView, timeout: 8, description: "native promise bridge bootstrap") {
            (try? evaluate(webView, "window.__viewerSmokeResult !== null")) as? Bool == true
        }
        let bootstrap = try resultObject(webView)
        guard (bootstrap["document"] as? [String: Any])?["kind"] as? String == "loaded",
              (bootstrap["document"] as? [String: Any])?["name"] as? String == "smoke.md" else {
            throw SmokeFailure.message("Native bootstrap returned an unexpected document snapshot.")
        }

        _ = try evaluate(webView, "window.__viewerSmokeResult=null; window.webkit.messageHandlers.viewer.postMessage({action:'defaultAppStatus'}).then(value=>window.__viewerSmokeResult=value).catch(error=>window.__viewerSmokeResult={error:String(error)}); true")
        try wait(webView, timeout: 8, description: "native default app status query") {
            (try? evaluate(webView, "window.__viewerSmokeResult !== null")) as? Bool == true
        }
        let defaultAppStatus = try resultObject(webView)
        guard defaultAppStatus.keys.sorted() == ["canToggle", "currentAppName", "isViewerDefault", "previousAppName"],
              defaultAppStatus["isViewerDefault"] as? Bool == false,
              defaultAppStatus["canToggle"] as? Bool == true,
              defaultAppStatus["currentAppName"] as? String == "Preview",
              defaultAppStatus["previousAppName"] is NSNull else {
            throw SmokeFailure.message("Native default app query returned an unexpected or path-bearing status.")
        }

        _ = try evaluate(webView, "window.__viewerSmokeResult=null; window.webkit.messageHandlers.viewer.postMessage({action:'setDefaultApp',enabled:true,extra:'not-a-settings-action'}).then(value=>window.__viewerSmokeResult=value).catch(error=>window.__viewerSmokeResult={error:String(error)}); true")
        try wait(webView, timeout: 8, description: "rejected malformed default app command") {
            (try? evaluate(webView, "window.__viewerSmokeResult !== null")) as? Bool == true
        }
        let malformed = try evaluate(webView, "JSON.stringify(window.__viewerSmokeResult)") as? String ?? ""
        guard malformed.contains("default app request is malformed") && launchServices.setCalls.isEmpty else {
            throw SmokeFailure.message("The native bridge accepted a malformed default app command.")
        }

        _ = try evaluate(webView, "document.querySelector('[aria-label=\\\"Settings\\\"]').click(); true")
        try wait(webView, timeout: 8, description: "Settings open") {
            (try? evaluate(webView, "document.querySelector('.viewer-settings') !== null")) as? Bool == true
        }
        let generalSelected = try evaluate(webView, "document.querySelector('#viewer-settings-tab-general')?.getAttribute('aria-selected') === 'true'") as? Bool == true
        guard generalSelected else {
            let state = try evaluate(webView, "JSON.stringify({tabs:Array.from(document.querySelectorAll('[role=tab]')).map(tab=>({id:tab.id,text:tab.textContent,selected:tab.getAttribute('aria-selected')})),body:document.body.innerText})") as? String ?? "unavailable"
            throw SmokeFailure.message("Settings did not open on General: \(state)")
        }
        try wait(webView, timeout: 8, description: "default app settings query") {
            (try? evaluate(webView, "document.querySelector('.viewer-default-app-caption')?.textContent === 'Markdown files open in Preview.'")) as? Bool == true
        }
        try captureDefaultAppEvidence(controller, webView: webView, state: "off")
        launchServices.setDelayNanoseconds = 600_000_000
        _ = try evaluate(webView, "document.querySelector('.viewer-default-app-switch').click(); true")
        try wait(webView, timeout: 5, description: "pending default app switch") {
            (try? evaluate(webView, "(() => { const toggle=document.querySelector('.viewer-default-app-switch'); return toggle?.getAttribute('aria-checked')==='true' && toggle.disabled && document.querySelector('.viewer-default-app-row')?.getAttribute('aria-busy')==='true' && document.querySelector('.viewer-default-app-caption')?.textContent==='Changing the default app…'; })()")) as? Bool == true
        }
        try captureDefaultAppEvidence(controller, webView: webView, state: "pending")
        try wait(webView, timeout: 8, description: "enabled default app switch and status re-query") {
            (try? evaluate(webView, "(() => { const toggle=document.querySelector('.viewer-default-app-switch'); return toggle?.getAttribute('aria-checked')==='true' && !toggle.disabled && document.querySelector('.viewer-default-app-caption')?.textContent==='Turn off to go back to Preview.'; })()")) as? Bool == true
        }
        try captureDefaultAppEvidence(controller, webView: webView, state: "on")
        guard launchServices.setCalls == launchServices.markdownContentTypeIdentifiers else {
            throw SmokeFailure.message("Settings did not set every distinct Markdown content type through the injected adapter.")
        }
        _ = try evaluate(webView, "document.querySelector('.viewer-default-app-switch').click(); true")
        try wait(webView, timeout: 8, description: "restored default app switch") {
            (try? evaluate(webView, "(() => { const toggle=document.querySelector('.viewer-default-app-switch'); return toggle?.getAttribute('aria-checked')==='false' && !toggle.disabled && document.querySelector('.viewer-default-app-caption')?.textContent==='Markdown files open in Preview.'; })()")) as? Bool == true
        }
        guard launchServices.setBundleIdentifierCalls == [launchServices.viewerBundleIdentifier!, launchServices.viewerBundleIdentifier!,
                                                            launchServices.previewBundleIdentifier, launchServices.previewBundleIdentifier] else {
            throw SmokeFailure.message("Turning the switch off did not restore the previous app for every Markdown content type.")
        }
        _ = try evaluate(webView, "document.querySelector('.viewer-done-button').click(); true")
        try wait(webView, timeout: 8, description: "reader restored after default app settings") {
            (try? evaluate(webView, "document.querySelector('.viewer-markdown') !== null")) as? Bool == true
        }

        _ = try evaluate(webView, "window.__viewerSmokeResult=null; window.webkit.messageHandlers.viewer.postMessage({action:'preferences',preferences:{themeID:'system',syntaxThemeID:'app',fontID:'space-mono',fontWeight:400,fontSize:17,focusedOpacity:1,unfocusedOpacity:1,glass:0}}).then(value=>window.__viewerSmokeResult=value).catch(error=>window.__viewerSmokeResult={error:String(error)}); true")
        try wait(webView, timeout: 8, description: "native promise bridge preferences") {
            (try? evaluate(webView, "window.__viewerSmokeResult !== null")) as? Bool == true
        }
        let preferenceReply = try resultObject(webView)
        guard (preferenceReply["preferences"] as? [String: Any])?["fontSize"] as? Int == 17,
              defaults.data(forKey: "viewerPreferences.v1") != nil else {
            throw SmokeFailure.message("Native preferences reply was not validated and persisted in the isolated domain.")
        }

        _ = try evaluate(webView, "window.__viewerSmokeResult=null; window.webkit.messageHandlers.viewer.postMessage({action:'preferences',preferences:{themeID:'system',syntaxThemeID:'app',fontID:'space-mono',fontWeight:400,fontSize:17,focusedOpacity:1,unfocusedOpacity:1,glass:0.4}}).then(value=>window.__viewerSmokeResult=value).catch(error=>window.__viewerSmokeResult={error:String(error)}); true")
        try wait(webView, timeout: 8, description: "native glass preference") {
            (try? evaluate(webView, "window.__viewerSmokeResult !== null")) as? Bool == true
        }
        let effects = controller.window?.contentView?.subviews.compactMap { $0 as? NSVisualEffectView }.first
        guard let window = controller.window, let effects,
              abs(window.backgroundColor.alphaComponent - 0.6) < 0.01,
              abs(effects.alphaValue - 0.4) < 0.01, !effects.isHidden, effects.state == .active,
              !window.isOpaque, abs(window.alphaValue - 1) < 0.01 else {
            throw SmokeFailure.message("Native glass did not blend an alpha theme surface with vibrancy without dimming foreground content.")
        }

        try writeAtomically(Data("# Atomic replacement arrived\n\n![Local image](smoke.png)\n".utf8), to: first)
        try wait(webView, timeout: 12, description: "atomic file replacement refresh") {
            (try? evaluate(webView, "(document.body?.innerText || '').includes('Atomic replacement arrived')")) as? Bool == true
        }

        try FileManager.default.removeItem(at: first)
        try wait(webView, timeout: 12, description: "deleted-file error") {
            (try? evaluate(webView, "(document.body?.innerText || '').toLowerCase().includes('unavailable')")) as? Bool == true
        }
        try writeAtomically(Data("# Recovered after deletion\n".utf8), to: first)
        try wait(webView, timeout: 12, description: "deleted-file recovery") {
            (try? evaluate(webView, "(document.body?.innerText || '').includes('Recovered after deletion')")) as? Bool == true
        }

        runtime.open([first, second])
        guard runtime.windowControllers.count == 2,
              let secondController = runtime.controller(for: second) else {
            throw SmokeFailure.message("Opening two file URLs did not create two document windows.")
        }
        runtime.open([second, second])
        guard runtime.windowControllers.count == 2 else {
            throw SmokeFailure.message("Opening the same canonical URL did not deduplicate its document window.")
        }
        try wait(secondController.webView!, timeout: 20, description: "second URL rendering") {
            (try? evaluate(secondController.webView!, "(document.body?.innerText || '').includes('Second window document')")) as? Bool == true
        }

        for openWindow in runtime.windowControllers { openWindow.window?.close() }
        let closeDeadline = Date().addingTimeInterval(3)
        while !runtime.windowControllers.isEmpty && Date() < closeDeadline {
            _ = RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.025))
        }
        guard runtime.windowControllers.isEmpty else { throw SmokeFailure.message("Document windows did not close cleanly.") }
        let lifecycleDefaults = UserDefaults(suiteName: "BananaViewerSmoke-Lifecycle-\(UUID().uuidString)")!
        let lifecycleRuntime = try ViewerApplicationRuntime(webDirectory: webDirectory, defaults: lifecycleDefaults)
        try verifyClosedControllerCleanup(lifecycleRuntime, document: first)
        runtime.sendMenuCommand("settings")
        guard runtime.windowControllers.count == 1,
              let settingsController = runtime.windowControllers.first,
              settingsController.documentURL == nil else {
            throw SmokeFailure.message("Settings did not create an empty viewer window after all documents closed.")
        }
        try wait(settingsController.webView!, timeout: 20, description: "queued Settings command on a cold window") {
            (try? evaluate(settingsController.webView!, "document.querySelector('.viewer-settings') !== null")) as? Bool == true
        }
        print("Viewer WebKit smoke passed: rendering, bridge validation, default-app off/pending/on/restore states through a fake LaunchServices adapter, transparent surface, native glass, relative image, atomic refresh, delete/recovery, multi-URL deduplication, and cold Settings delivery.")
    }

    private static func captureDefaultAppEvidence(_ controller: ViewerWindowController, webView: WKWebView, state: String) throws {
        guard let directory = ProcessInfo.processInfo.environment["VIEWER_SMOKE_SCREENSHOT_DIR"],
              let window = controller.window else { return }
        let folder = URL(fileURLWithPath: directory, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        _ = try evaluate(webView, "(() => { const toggle=document.querySelector('.viewer-default-app-switch'); const thumb=document.querySelector('.viewer-default-app-switch-thumb'); toggle?.style.setProperty('transition','none','important'); thumb?.style.setProperty('transition','none','important'); return true; })()")
        _ = NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        NSApp.updateWindows()
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        let destination = folder.appendingPathComponent("banana-viewer-default-\(state).png")
        let capture = Process()
        capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        capture.arguments = ["-x", "-l", String(window.windowNumber), destination.path]
        try capture.run(); capture.waitUntilExit()
        guard capture.terminationStatus == 0 else {
            throw SmokeFailure.message("Could not capture the \(state) default-app Settings state.")
        }
    }

    private static func verifyClosedControllerCleanup(_ runtime: ViewerApplicationRuntime, document: URL) throws {
        runtime.open([document])
        guard let controller = runtime.controller(for: document) else {
            throw SmokeFailure.message("Could not open lifecycle regression document.")
        }
        controller.show()
        let webView = controller.webView!
        try wait(webView, timeout: 20, description: "lifecycle regression page load") {
            (try? evaluate(webView, "document.readyState === 'complete'")) as? Bool == true
        }
        controller.window?.close()
        guard controller.webView == nil, controller.window == nil else {
            throw SmokeFailure.message("Closing a document did not release its window and WebKit view.")
        }
        guard runtime.controller(for: document) == nil else {
            throw SmokeFailure.message("Closing a document did not remove its controller from the runtime.")
        }
    }

    private static func resultObject(_ webView: WKWebView) throws -> [String: Any] {
        guard let json = try evaluate(webView, "JSON.stringify(window.__viewerSmokeResult)") as? String,
              let data = json.data(using: .utf8),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["error"] == nil else {
            throw SmokeFailure.message("The native promise bridge returned no valid result.")
        }
        return object
    }

    private static func evaluate(_ webView: WKWebView, _ script: String) throws -> Any? {
        var finished = false
        var result: Any?
        var failure: Error?
        webView.evaluateJavaScript(script) { value, error in
            result = value
            failure = error
            finished = true
        }
        let deadline = Date().addingTimeInterval(5)
        while !finished && Date() < deadline {
            _ = RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.025))
        }
        guard finished else { throw SmokeFailure.message("WebKit JavaScript evaluation timed out.") }
        if let failure {
            fputs("WebKit evaluation failed for: \(script)\\n", stderr)
            throw failure
        }
        return result
    }

    private static func wait(_ webView: WKWebView, timeout: TimeInterval, description: String,
                             condition: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try condition() { return }
            _ = RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        throw SmokeFailure.message("Timed out waiting for \(description).")
    }

    private static func writeAtomically(_ data: Data, to destination: URL) throws {
        let temporary = destination.deletingLastPathComponent().appendingPathComponent(".\(UUID().uuidString).tmp")
        try data.write(to: temporary)
        let result = temporary.path.withCString { source in
            destination.path.withCString { target in Darwin.rename(source, target) }
        }
        guard result == 0 else { throw SmokeFailure.message("Could not atomically replace synthetic document.") }
    }
}

enum SmokeFailure: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}

@MainActor
private final class SmokeViewerLaunchServices: ViewerLaunchServices {
    let viewerBundleIdentifier: ViewerBundleIdentifier? = ViewerBundleIdentifier("com.jzlosman.banana-viewer")
    let previewBundleIdentifier = ViewerBundleIdentifier("com.apple.Preview")!
    let markdownContentTypeIdentifiers = ["test.viewer-markdown", "test.viewer-md"]
    var setCalls: [String] = []
    var setBundleIdentifierCalls: [ViewerBundleIdentifier] = []
    var setDelayNanoseconds: UInt64 = 0
    private var applications: [String: ViewerDefaultApplication]
    private let registeredApplications: [ViewerBundleIdentifier: ViewerDefaultApplication]

    init() {
        let preview = ViewerDefaultApplication(bundleIdentifier: previewBundleIdentifier, displayName: "Preview")
        let viewer = ViewerDefaultApplication(bundleIdentifier: viewerBundleIdentifier, displayName: "Banana Viewer (build copy)")
        applications = ["test.viewer-markdown": preview, "test.viewer-md": preview]
        registeredApplications = [previewBundleIdentifier: preview, viewerBundleIdentifier!: viewer]
    }

    func currentApplication(forContentTypeIdentifier identifier: String) -> ViewerDefaultApplication? {
        applications[identifier]
    }

    func application(forBundleIdentifier identifier: ViewerBundleIdentifier) -> ViewerDefaultApplication? {
        registeredApplications[identifier]
    }

    func setDefaultApplication(bundleIdentifier: ViewerBundleIdentifier, forContentTypeIdentifier identifier: String) async -> Bool {
        if setDelayNanoseconds > 0 { try? await Task.sleep(nanoseconds: setDelayNanoseconds) }
        setCalls.append(identifier); setBundleIdentifierCalls.append(bundleIdentifier)
        applications[identifier] = registeredApplications[bundleIdentifier]
        return applications[identifier] != nil
    }
}
