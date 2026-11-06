import AppKit
import Foundation
import WebKit

@main
@MainActor
struct TasksWebKitSelfTest {
    private static let emptyDocumentJSON = #"{"version":1,"tasks":[],"runningSession":null,"todoistOutbox":[]}"#
    private static let taskTitle = "Tasks WebKit smoke capture"

    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            throw SmokeFailure.message("Usage: TasksWebKitSelfTest <built Tasks web directory>")
        }
        let webDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true).standardizedFileURL
        try checkBuiltAssets(webDirectory)
        try checkBridgePolicy(webDirectory)

        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("banana-tasks-webkit-smoke-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let profile = root.appendingPathComponent("verification-profile", isDirectory: true)
        let dataDirectory = profile.appendingPathComponent("data", isDirectory: true)
        try TasksLocalDocumentStore.ensureDirectory(dataDirectory)
        let dataURL = dataDirectory.appendingPathComponent("tasks.json")
        try Data(emptyDocumentJSON.utf8).write(to: dataURL, options: .atomic)

        let bundleInfo: [String: Any] = [
            TasksProfileResolver.bundleIdentifierKey: "\(TasksProfileResolver.verificationBundleIdentifierPrefix)webkit-smoke",
            TasksProfileResolver.verificationProfileInfoKey: profile.path,
        ]
        let resolvedProfile = try TasksProfileResolver.resolve(
            bundleInfo: bundleInfo, environment: [:],
            applicationSupport: root.appendingPathComponent("must-not-be-used", isDirectory: true))
        guard case let .verification(resolvedDirectory, suiteName) = resolvedProfile,
              resolvedDirectory == dataDirectory.standardizedFileURL else {
            throw SmokeFailure.message("The verification profile did not resolve to its private data directory.")
        }

        guard let defaults = UserDefaults(suiteName: suiteName) else {
            throw SmokeFailure.message("Could not create isolated Tasks verification preferences.")
        }
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let catalog = try TasksThemeCatalog(data: Data(contentsOf: webDirectory.appendingPathComponent("theme-catalog.json")))
        let documents = try TasksLocalDocumentStore(directory: resolvedDirectory)
        let preferences = UserDefaultsTasksPreferences(defaults: defaults, catalog: catalog)
        let application = TasksApplication(documents: documents, preferences: preferences,
                                           todoist: VerificationTodoistPort(), calendar: VerificationCalendarPort())
        try assertProfileInitializesReady(application.loadTasks())

        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let controller = TasksWindowController(webDirectory: webDirectory, catalog: catalog,
                                               preferences: preferences.load())
        var navigationError: String?
        controller.onError = { navigationError = $0 }
        let bridge = TasksBridgeRouter(application: application, clipboard: VerificationClipboard())
        controller.router = bridge
        bridge.onFlushAcknowledged = { [weak controller] requestID, saved in
            controller?.acknowledgeFlush(requestID: requestID, saved: saved)
        }
        bridge.onDragRegion = { [weak controller] in controller?.setDragRegion($0) ?? false }
        bridge.onPreferencesSaved = { [weak controller] in controller?.applyPreferences($0) }
        defer { controller.shutdown() }

        controller.show()
        guard let webView = controller.webView else {
            throw SmokeFailure.message("TasksWindowController did not construct its WebKit view.")
        }
        try wait(timeout: 20, description: "Tasks page load") {
            (try? evaluate(webView, "location.pathname.endsWith('/tasks.html') && document.readyState === 'complete'")) as? Bool == true
        }
        try assertNoNavigationError(navigationError)
        try installPageErrorCapture(webView)
        try assertApplicationReady(webView)
        try assertLoadedAssetsAndFont(webView)

        let initialLoad = try postBridge(webView, message: ["action": "loadTasks"])
        let initialDocument = try checkedReadyDocument(initialLoad)
        guard let initialTasks = initialDocument["tasks"] as? [Any], initialTasks.isEmpty else {
            throw SmokeFailure.message("The seeded verification Tasks profile did not initialize as an empty ready document.")
        }
        let initialRevision = initialLoad["revision"] as? String ?? ""
        try assertValidRevision(initialRevision)

        let malformedReply = try postBridge(webView, message: ["action": "loadTasks", "unexpected": true])
        guard malformedReply["kind"] as? String == "error",
              (malformedReply["message"] as? String)?.contains("request is invalid") == true else {
            throw SmokeFailure.message("The actual WebKit bridge accepted a malformed message.")
        }

        try createTaskThroughForm(webView)
        try wait(timeout: 10, description: "quick-capture persistence") {
            (Self.persistedDocument(at: dataURL)?["tasks"] as? [[String: Any]])?
                .contains(where: { $0["title"] as? String == taskTitle }) == true
        }
        guard let persisted = Self.persistedDocument(at: dataURL) else {
            throw SmokeFailure.message("The quick-capture task was not persisted as JSON.")
        }
        try assertDocumentShape(persisted, includesTask: taskTitle)

        let afterCreate = try postBridge(webView, message: ["action": "loadTasks"])
        let createdDocument = try checkedReadyDocument(afterCreate)
        try assertDocumentShape(createdDocument, includesTask: taskTitle)
        guard sameJSONValue(createdDocument, persisted) else {
            throw SmokeFailure.message("The native load response did not match the complete persisted Tasks document.")
        }
        let createdRevision = afterCreate["revision"] as? String ?? ""
        try assertValidRevision(createdRevision)

        var timerDocument = createdDocument
        guard let createdTask = (timerDocument["tasks"] as? [[String: Any]])?.first(where: { $0["title"] as? String == taskTitle }),
              let taskID = createdTask["id"] as? String,
              let createdAt = (createdTask["createdAt"] as? NSNumber)?.doubleValue,
              createdAt.isFinite, createdAt >= 0, createdAt.rounded() == createdAt,
              (createdTask["status"] as? [String: Any])?["kind"] as? String == "active" else {
            throw SmokeFailure.message("The captured task did not have an active, timestamped domain shape for timer-intent verification.")
        }
        let timerID = "smoke-session-1"
        timerDocument["runningSession"] = ["id": timerID, "taskID": taskID, "startedAt": createdAt]
        try assertRunningSession(timerDocument, id: timerID, taskID: taskID, startedAt: createdAt)
        let saveReply = try postBridge(webView, message: [
            "action": "saveTasks", "expectedRevision": createdRevision, "document": timerDocument,
        ])
        guard Set(saveReply.keys) == ["kind", "revision"], saveReply["kind"] as? String == "saved",
              let savedRevision = saveReply["revision"] as? String else {
            throw SmokeFailure.message("The actual WebKit bridge returned an invalid native save response shape.")
        }
        try assertValidRevision(savedRevision)
        try wait(timeout: 8, description: "persisted timer intent") {
            let session = Self.persistedDocument(at: dataURL)?["runningSession"] as? [String: Any]
            return session?["id"] as? String == timerID && session?["taskID"] as? String == taskID
        }
        guard let timerPersisted = Self.persistedDocument(at: dataURL) else {
            throw SmokeFailure.message("The timer-intent document was not persisted to the verification profile.")
        }
        try assertDocumentShape(timerPersisted, includesTask: taskTitle)
        try assertRunningSession(timerPersisted, id: timerID, taskID: taskID, startedAt: createdAt)

        _ = try evaluate(webView, "window.__tasksWebKitOldPage = true; true")
        guard webView.reload() != nil else {
            throw SmokeFailure.message("WebKit did not begin reloading the Tasks page.")
        }
        try wait(timeout: 20, description: "Tasks page reload") {
            (try? evaluate(webView, "document.readyState === 'complete' && window.__tasksWebKitOldPage === undefined && !!document.querySelector('form[aria-label=\\\"Add task\\\"]')")) as? Bool == true
        }
        try assertNoNavigationError(navigationError)
        try installPageErrorCapture(webView)
        try assertApplicationReady(webView)
        try assertLoadedAssetsAndFont(webView)
        let reloaded = try postBridge(webView, message: ["action": "loadTasks"])
        let reloadedDocument = try checkedReadyDocument(reloaded)
        try assertDocumentShape(reloadedDocument, includesTask: taskTitle)
        try assertRunningSession(reloadedDocument, id: timerID, taskID: taskID, startedAt: createdAt)
        guard sameJSONValue(reloadedDocument, timerPersisted), reloaded["revision"] as? String == savedRevision else {
            throw SmokeFailure.message("The created task and running timer intent did not survive a full WebKit reload with their native revision.")
        }

        var flushResult: Bool?
        controller.requestFlush { flushResult = $0 }
        try wait(timeout: 8, description: "native flush acknowledgement") { flushResult != nil }
        guard flushResult == true else {
            throw SmokeFailure.message("The native flush request was not acknowledged as saved.")
        }
        guard let flushed = Self.persistedDocument(at: dataURL) else {
            throw SmokeFailure.message("The flushed verification document could not be read back.")
        }
        try assertDocumentShape(flushed, includesTask: taskTitle)
        try assertRunningSession(flushed, id: timerID, taskID: taskID, startedAt: createdAt)
        controller.hideAfterFlush()
        try wait(timeout: 8, description: "hide after native flush") { !controller.isVisible }
        controller.show()
        try wait(timeout: 5, description: "show after hide") { controller.isVisible }

        let completionClicked = try evaluate(webView, """
            (() => {
              const button = document.querySelector('button[aria-label^="Complete task:"]');
              if (!button) return false;
              button.click();
              return true;
            })()
            """) as? Bool == true
        guard completionClicked else { throw SmokeFailure.message("The running task could not be completed through its actual UI control.") }
        try wait(timeout: 8, description: "atomic running-timer completion") {
            guard let document = Self.persistedDocument(at: dataURL), document["runningSession"] is NSNull,
                  let task = (document["tasks"] as? [[String: Any]])?.first(where: { $0["id"] as? String == taskID }) else { return false }
            return (task["status"] as? [String: Any])?["kind"] as? String == "completed"
        }
        guard let completed = Self.persistedDocument(at: dataURL),
              let task = (completed["tasks"] as? [[String: Any]])?.first(where: { $0["id"] as? String == taskID }),
              (task["createdAt"] as? NSNumber)?.doubleValue == createdAt,
              let work = task["work"] as? [[String: Any]],
              work.reduce(0.0, { $0 + (($1["durationMs"] as? NSNumber)?.doubleValue ?? 0) }) > 0 else {
            throw SmokeFailure.message("Completing the running timer did not preserve capture age and settle recorded effort.")
        }

        try assertNoJavaScriptErrors(webView)
        try assertNoNavigationError(navigationError)
        print("Banana Tasks WebKit smoke passed (verification profile ready, native bridge load/save, quick capture persistence/reload, running timer intent and atomic completion, bundled font, flush and hide/show).")
    }

    private static func checkBuiltAssets(_ directory: URL) throws {
        let required = ["tasks.html", "tasks.js", "tasks.css", "app.css", "theme-catalog.json", "fonts/manifest.js"]
        for path in required where !FileManager.default.fileExists(atPath: directory.appendingPathComponent(path).path) {
            throw SmokeFailure.message("Missing built Tasks WebKit asset: \(directory.appendingPathComponent(path).path)")
        }
        let fonts = try FileManager.default.contentsOfDirectory(at: directory.appendingPathComponent("fonts"),
                                                                includingPropertiesForKeys: nil)
        guard fonts.contains(where: { $0.pathExtension == "woff2" }) else {
            throw SmokeFailure.message("The built Tasks web directory has no WOFF2 font assets.")
        }
    }

    private static func checkBridgePolicy(_ webDirectory: URL) throws {
        let index = webDirectory.appendingPathComponent("tasks.html")
        let otherPage = webDirectory.appendingPathComponent("other.html")
        guard TasksBridgeSecurityPolicy.allows(isMainFrame: true, frameURL: index, bundledIndexURL: index),
              !TasksBridgeSecurityPolicy.allows(isMainFrame: false, frameURL: index, bundledIndexURL: index),
              !TasksBridgeSecurityPolicy.allows(isMainFrame: true, frameURL: otherPage, bundledIndexURL: index),
              !TasksBridgeSecurityPolicy.allows(isMainFrame: true, frameURL: URL(string: "https://example.invalid")!, bundledIndexURL: index) else {
            throw SmokeFailure.message("The Tasks bridge origin policy did not restrict messages to the bundled main document.")
        }
    }

    private static func assertProfileInitializesReady(_ loaded: LoadedTasks) throws {
        switch loaded.result {
        case let .ready(document, revision):
            guard let document = document as? [String: Any], revision == TasksLocalDocumentStore.revision(for: Data(emptyDocumentJSON.utf8)) else {
                throw SmokeFailure.message("The verification profile did not load its complete seeded document and revision.")
            }
            try assertDocumentShape(document, includesTask: nil)
            guard (document["tasks"] as? [Any])?.isEmpty == true,
                  document["runningSession"] is NSNull,
                  (document["todoistOutbox"] as? [Any])?.isEmpty == true else {
                throw SmokeFailure.message("The verification profile seed was not the expected valid empty Tasks document.")
            }
        case .unreadable:
            throw SmokeFailure.message("The seeded verification profile initialized as unreadable instead of ready.")
        }
    }

    private static func assertApplicationReady(_ webView: WKWebView) throws {
        let readinessScript = """
            (() => {
              const root = document.querySelector('#app');
              const form = root?.querySelector('form[aria-label="Add task"]');
              const title = form?.querySelector('[name="title"]');
              const submit = Array.from(form?.elements ?? []).some(element =>
                (element instanceof HTMLButtonElement && element.type === 'submit') ||
                (element instanceof HTMLInputElement && element.type === 'submit'));
              return document.documentElement.dataset.native === 'true' && root && root.getAttribute('aria-busy') !== 'true' &&
                title instanceof HTMLInputElement && submit;
            })()
            """
        do {
            try wait(timeout: 20, description: "native Tasks application readiness") {
                (try? evaluate(webView, readinessScript)) as? Bool == true
            }
        } catch {
            let details = (try? evaluate(webView, "JSON.stringify({native:document.documentElement.dataset.native,busy:document.querySelector('#app')?.getAttribute('aria-busy'),body:document.body?.innerText})")) as? String ?? "unavailable"
            throw SmokeFailure.message("The Tasks page did not initialize a ready native quick-capture form: \(details)")
        }
    }

    private static func assertLoadedAssetsAndFont(_ webView: WKWebView) throws {
        let assetsLoaded = try evaluate(webView, """
            (() => {
              const styles = Array.from(document.styleSheets).map(sheet => sheet.href || '');
              const scripts = Array.from(document.scripts).map(script => script.src || '');
              return styles.some(url => url.endsWith('/app.css')) && styles.some(url => url.endsWith('/tasks.css')) &&
                scripts.some(url => url.endsWith('/tasks.js')) &&
                Array.isArray(globalThis.__BANANA_NOTE_FONT_MANIFEST__?.fonts) &&
                globalThis.__BANANA_NOTE_FONT_MANIFEST__.fonts.some(font => font.kind === 'bundled' && font.faces?.length);
            })()
            """) as? Bool == true
        guard assetsLoaded else {
            throw SmokeFailure.message("The built Tasks JavaScript, CSS, or bundled font manifest did not load.")
        }

        _ = try evaluate(webView, """
            window.__tasksWebKitFontLoaded = undefined;
            (() => {
              const font = globalThis.__BANANA_NOTE_FONT_MANIFEST__.fonts.find(item => item.kind === 'bundled' && item.faces?.length);
              const face = font?.faces?.[0];
              if (!face || typeof face.file !== 'string' || !/^[A-Za-z0-9-]+\\.woff2$/.test(face.file)) {
                window.__tasksWebKitFontLoaded = false;
                return;
              }
              new FontFace('Tasks WebKit smoke font', `url("fonts/${face.file}")`, { weight: face.weight })
                .load().then(loaded => {
                  document.fonts.add(loaded);
                  window.__tasksWebKitFontLoaded = loaded.status === 'loaded';
                }).catch(error => {
                  window.__tasksWebKitFontError = String(error);
                  window.__tasksWebKitFontLoaded = false;
                });
            })();
            true
            """)
        try wait(timeout: 8, description: "built bundled WOFF2 font load") {
            (try? evaluate(webView, "window.__tasksWebKitFontLoaded !== undefined")) as? Bool == true
        }
        guard (try evaluate(webView, "window.__tasksWebKitFontLoaded === true")) as? Bool == true else {
            let details = (try? evaluate(webView, "String(window.__tasksWebKitFontError || 'font load failed')")) as? String ?? "font load failed"
            throw SmokeFailure.message("A real bundled Tasks WOFF2 font did not load in WebKit: \(details)")
        }
    }

    private static func installPageErrorCapture(_ webView: WKWebView) throws {
        _ = try evaluate(webView, """
            window.__tasksWebKitSmokeErrors = [];
            window.addEventListener('error', event => window.__tasksWebKitSmokeErrors.push(String(event.message || event.error || 'JavaScript error')));
            window.addEventListener('unhandledrejection', event => window.__tasksWebKitSmokeErrors.push(String(event.reason)));
            true
            """)
    }

    private static func assertNoJavaScriptErrors(_ webView: WKWebView) throws {
        let errors = (try evaluate(webView, "JSON.stringify(window.__tasksWebKitSmokeErrors || [])")) as? String ?? "[]"
        guard let data = errors.data(using: .utf8),
              let values = try JSONSerialization.jsonObject(with: data) as? [String], values.isEmpty else {
            throw SmokeFailure.message("Tasks WebKit reported a JavaScript error: \(errors)")
        }
    }

    private static func assertNoNavigationError(_ error: String?) throws {
        guard let error else { return }
        throw SmokeFailure.message("Tasks WebKit navigation failed: \(error)")
    }

    private static func createTaskThroughForm(_ webView: WKWebView) throws {
        let title = try JSONSerialization.data(withJSONObject: taskTitle, options: [.fragmentsAllowed])
        let literal = String(data: title, encoding: .utf8)!
        let submitted = try evaluate(webView, """
            (() => {
              const form = document.querySelector('form[aria-label="Add task"]');
              const input = form?.querySelector('[name="title"]');
              const button = Array.from(form?.elements ?? []).find(element => element instanceof HTMLButtonElement && element.type === 'submit');
              if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) return false;
              input.value = \(literal);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              form.requestSubmit(button);
              return true;
            })()
            """) as? Bool == true
        guard submitted else { throw SmokeFailure.message("Could not submit the semantic Tasks quick-capture form.") }
    }

    private static func postBridge(_ webView: WKWebView, message: [String: Any]) throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: message, options: [.fragmentsAllowed])
        let encoded = data.base64EncodedString()
        _ = try evaluate(webView, """
            (() => {
              window.__tasksWebKitSmokeResult = undefined;
              const request = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('\(encoded)'), character => character.charCodeAt(0))));
              window.webkit.messageHandlers.bananaTasks.postMessage(request).then(
                value => { window.__tasksWebKitSmokeResult = { kind: 'reply', value }; },
                error => { window.__tasksWebKitSmokeResult = { kind: 'error', message: String(error) }; }
              );
              return true;
            })()
            """)
        try wait(timeout: 8, description: "native bridge \(message["action"] as? String ?? "reply")") {
            (try? evaluate(webView, "window.__tasksWebKitSmokeResult !== undefined")) as? Bool == true
        }
        let json = try evaluate(webView, "JSON.stringify(window.__tasksWebKitSmokeResult)") as? String ?? "null"
        guard let resultData = json.data(using: .utf8),
              let result = try JSONSerialization.jsonObject(with: resultData) as? [String: Any] else {
            throw SmokeFailure.message("The Tasks bridge returned a non-object result: \(json)")
        }
        if result["kind"] as? String == "error" { return result }
        guard result["kind"] as? String == "reply", let value = result["value"] as? [String: Any] else {
            throw SmokeFailure.message("The Tasks bridge returned an invalid reply envelope: \(json)")
        }
        return value
    }

    private static func checkedReadyDocument(_ response: [String: Any]) throws -> [String: Any] {
        guard Set(response.keys) == ["kind", "document", "revision"], response["kind"] as? String == "ready",
              let document = response["document"] as? [String: Any], let revision = response["revision"] as? String else {
            throw SmokeFailure.message("The actual WebKit Tasks load response did not have the ready/document/revision shape.")
        }
        try assertValidRevision(revision)
        try assertDocumentShape(document, includesTask: nil)
        return document
    }

    private static func assertDocumentShape(_ document: [String: Any], includesTask title: String?) throws {
        guard Set(document.keys) == ["version", "tasks", "runningSession", "todoistOutbox"],
              (document["version"] as? NSNumber)?.intValue == 1,
              let tasks = document["tasks"] as? [[String: Any]],
              (document["runningSession"] is NSNull || document["runningSession"] is [String: Any]),
              document["todoistOutbox"] as? [Any] != nil else {
            throw SmokeFailure.message("A Tasks document did not preserve its complete application schema.")
        }
        if let title, !tasks.contains(where: { $0["title"] as? String == title }) {
            throw SmokeFailure.message("The persisted Tasks document did not contain the submitted quick-capture title.")
        }
    }

    private static func assertRunningSession(_ document: [String: Any], id: String, taskID: String,
                                              startedAt: Double) throws {
        guard let session = document["runningSession"] as? [String: Any],
              Set(session.keys) == ["id", "taskID", "startedAt"],
              session["id"] as? String == id, session["taskID"] as? String == taskID,
              (session["startedAt"] as? NSNumber)?.doubleValue == startedAt else {
            throw SmokeFailure.message("The explicit running timer intent was not preserved in the Tasks document.")
        }
    }

    private static func assertValidRevision(_ revision: String) throws {
        guard revision.utf8.count == 64,
              revision.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw SmokeFailure.message("The native Tasks bridge returned an invalid document revision.")
        }
    }

    private static func persistedDocument(at url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return value
    }

    private static func sameJSONValue(_ lhs: Any, _ rhs: Any) -> Bool {
        guard let left = try? JSONSerialization.data(withJSONObject: lhs, options: [.fragmentsAllowed, .sortedKeys]),
              let right = try? JSONSerialization.data(withJSONObject: rhs, options: [.fragmentsAllowed, .sortedKeys]) else { return false }
        return left == right
    }

    private static func evaluate(_ webView: WKWebView, _ script: String) throws -> Any? {
        var result: Any?
        var evaluationError: Error?
        var completed = false
        webView.evaluateJavaScript(script) { value, error in
            result = value
            evaluationError = error
            completed = true
        }
        try wait(timeout: 5, description: "JavaScript evaluation") { completed }
        if let evaluationError { throw evaluationError }
        return result
    }

    private static func wait(timeout: TimeInterval, description: String, until condition: () -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            _ = RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.025))
        }
        throw SmokeFailure.message("Timed out waiting for \(description).")
    }
}

private enum SmokeFailure: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case let .message(value) = self { return value }
        return nil
    }
}
