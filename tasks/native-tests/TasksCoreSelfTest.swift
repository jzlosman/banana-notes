import CoreFoundation
import Foundation

@main
struct TasksCoreSelfTest {
    static func main() async throws {
        try storageBoundaries()
        try profileBinding()
        try preferenceAndBridgeBoundaries()
        try hotkeyPreferencesAndRegistrationPolicy()
        focusAndFlushTransitions()
        try await todoistIsolationAndPagination()
        try await todoistCredentialLifecycle()
        try await todoistCompletionSyncIdempotency()
        try await calendarConsentAndIdempotency()
        try await verificationEffectsAreDisabled()
        try bridgeOriginPolicy()
        print("Banana Tasks native core checks passed (CAS, recovery, profile isolation, bridge boundaries, focus/flush, Todoist account binding/lifecycle, Calendar consent and idempotency)")
    }

    private static func storageBoundaries() throws {
        let root = try temporaryDirectory("TasksStore")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try TasksLocalDocumentStore(directory: root.appendingPathComponent("data", isDirectory: true))
        let empty = try store.load()
        precondition(empty.document == nil && empty.revision == TasksLocalDocumentStore.emptyRevision)
        precondition(TasksLocalDocumentStore.emptyRevision == TasksLocalDocumentStore.revision(for: Data()))

        let first: [String: Any] = ["version": 1, "tasks": [["id": "synthetic-1", "title": "sample"]]]
        let revision1 = try store.save(expectedRevision: empty.revision, document: first)!
        let loaded1 = try store.load()
        precondition(loaded1.revision == revision1)
        precondition((loaded1.document as? [String: Any])?["tasks"] != nil)

        let second: [String: Any] = ["version": 1, "tasks": [["id": "synthetic-2", "title": "next"]]]
        let revision2 = try store.save(expectedRevision: revision1, document: second)!
        precondition(revision2 != revision1)
        let backup = try Data(contentsOf: root.appendingPathComponent("data/tasks.json.bak"))
        let backupObject = try JSONSerialization.jsonObject(with: backup) as? [String: Any]
        precondition((backupObject?["tasks"] as? [[String: Any]])?.first?["id"] as? String == "synthetic-1")
        let staleSave = try store.save(expectedRevision: revision1, document: first)
        precondition(staleSave == nil, "stale revisions must conflict")

        // Two independent store instances serialize their CAS writes through the same exclusive lock.
        let startingRevision = try store.load().revision
        let secondStore = try TasksLocalDocumentStore(directory: root.appendingPathComponent("data", isDirectory: true))
        let resultLock = NSLock()
        var successes = 0
        var conflicts = 0
        DispatchQueue.concurrentPerform(iterations: 2) { index in
            let candidate: [String: Any] = ["version": 1, "tasks": [["id": "parallel-\(index)"]]]
            let localStore = index == 0 ? store : secondStore
            let result = try! localStore.save(expectedRevision: startingRevision, document: candidate)
            resultLock.lock()
            if result == nil { conflicts += 1 } else { successes += 1 }
            resultLock.unlock()
        }
        precondition(successes == 1 && conflicts == 1, "one writer must win a shared-revision race")

        let corruptDirectory = root.appendingPathComponent("corrupt", isDirectory: true)
        try FileManager.default.createDirectory(at: corruptDirectory, withIntermediateDirectories: true)
        let corruptURL = corruptDirectory.appendingPathComponent("tasks.json")
        let corruptBytes = Data("not-json".utf8)
        try corruptBytes.write(to: corruptURL)
        let corruptStore = try TasksLocalDocumentStore(directory: corruptDirectory)
        expectFailure(TasksFailure.unreadableStore) { try corruptStore.load() }
        expectFailure(TasksFailure.unreadableStore) {
            try corruptStore.save(expectedRevision: TasksLocalDocumentStore.emptyRevision, document: first)
        }
        let preservedCorruptBytes = try Data(contentsOf: corruptURL)
        precondition(preservedCorruptBytes == corruptBytes, "corrupt files must never be replaced")

        let symlinkDirectory = root.appendingPathComponent("symlink-primary", isDirectory: true)
        try FileManager.default.createDirectory(at: symlinkDirectory, withIntermediateDirectories: true)
        let external = root.appendingPathComponent("outside.json")
        let externalBytes = Data("external sentinel".utf8)
        try externalBytes.write(to: external)
        try FileManager.default.createSymbolicLink(at: symlinkDirectory.appendingPathComponent("tasks.json"), withDestinationURL: external)
        let symlinkStore = try TasksLocalDocumentStore(directory: symlinkDirectory)
        expectFailure(TasksFailure.unreadableStore) { try symlinkStore.load() }
        expectFailure(TasksFailure.unreadableStore) {
            try symlinkStore.save(expectedRevision: TasksLocalDocumentStore.emptyRevision, document: first)
        }
        let preservedExternalBytes = try Data(contentsOf: external)
        precondition(preservedExternalBytes == externalBytes, "symlink targets must be left unchanged")

        let backupDirectory = root.appendingPathComponent("symlink-backup", isDirectory: true)
        let backupStore = try TasksLocalDocumentStore(directory: backupDirectory)
        let emptyRevision = try backupStore.load().revision
        let original: [String: Any] = ["version": 1, "tasks": [["id": "must-survive"]]]
        let originalRevision = try backupStore.save(expectedRevision: emptyRevision, document: original)!
        let backupTarget = root.appendingPathComponent("backup-target")
        let targetBytes = Data("keep this backup target".utf8)
        try targetBytes.write(to: backupTarget)
        try FileManager.default.createSymbolicLink(at: backupDirectory.appendingPathComponent("tasks.json.bak"), withDestinationURL: backupTarget)
        let replacement: [String: Any] = ["version": 1, "tasks": []]
        expectFailure(TasksFailure.storeWriteFailed) {
            try backupStore.save(expectedRevision: originalRevision, document: replacement)
        }
        let primaryAfterFailedBackup = try backupStore.load()
        let backupTargetAfterFailure = try Data(contentsOf: backupTarget)
        precondition(primaryAfterFailedBackup.revision == originalRevision)
        precondition(backupTargetAfterFailure == targetBytes)

        let oversizedDirectory = root.appendingPathComponent("oversized", isDirectory: true)
        try FileManager.default.createDirectory(at: oversizedDirectory, withIntermediateDirectories: true)
        try Data(repeating: 0x61, count: TasksLocalDocumentStore.maximumBytes + 1)
            .write(to: oversizedDirectory.appendingPathComponent("tasks.json"))
        let oversizedStore = try TasksLocalDocumentStore(directory: oversizedDirectory)
        expectFailure(TasksFailure.unreadableStore) { try oversizedStore.load() }
    }

    private static func profileBinding() throws {
        let root = try temporaryDirectory("TasksProfile")
        defer { try? FileManager.default.removeItem(at: root) }
        let profile = root.appendingPathComponent("verification", isDirectory: true)
        try FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true)
        let verificationID = "\(TasksProfileResolver.verificationBundleIdentifierPrefix)core-test"
        let info: [String: Any] = [
            TasksProfileResolver.bundleIdentifierKey: verificationID,
            TasksProfileResolver.verificationProfileInfoKey: profile.path,
        ]
        let expected = profile.appendingPathComponent("data", isDirectory: true).standardizedFileURL
        let withoutEnvironment = try TasksProfileResolver.resolve(bundleInfo: info, environment: [:],
                                                                   applicationSupport: root.appendingPathComponent("wrong"))
        guard case let .verification(directory, suiteName) = withoutEnvironment else {
            preconditionFailure("a verification bundle must resolve to verification capabilities")
        }
        precondition(directory == expected && suiteName.hasSuffix("verification"),
                     "verification launch without env must stay profile-bound")
        let withEnvironment = try TasksProfileResolver.resolve(bundleInfo: info,
            environment: [TasksProfileResolver.dataDirectoryEnvironmentKey: expected.path])
        guard case let .verification(withEnvironmentDirectory, _) = withEnvironment else { preconditionFailure() }
        precondition(withEnvironmentDirectory == expected)
        expectFailure(TasksFailure.invalidProfile) {
            try TasksProfileResolver.resolve(bundleInfo: info,
                environment: [TasksProfileResolver.dataDirectoryEnvironmentKey: root.appendingPathComponent("personal").path])
        }

        let productionSupport = root.appendingPathComponent("must-not-be-created", isDirectory: true)
        let invalidBundles: [[String: Any]] = [
            [TasksProfileResolver.bundleIdentifierKey: verificationID],
            [TasksProfileResolver.bundleIdentifierKey: verificationID,
             TasksProfileResolver.verificationProfileInfoKey: NSNull()],
            [TasksProfileResolver.bundleIdentifierKey: verificationID,
             TasksProfileResolver.verificationProfileInfoKey: 42],
            [TasksProfileResolver.bundleIdentifierKey: verificationID,
             TasksProfileResolver.verificationProfileInfoKey: ""],
            [TasksProfileResolver.bundleIdentifierKey: TasksProfileResolver.productionBundleIdentifier,
             TasksProfileResolver.verificationProfileInfoKey: profile.path],
            [TasksProfileResolver.bundleIdentifierKey: "com.example.unknown"],
            [TasksProfileResolver.bundleIdentifierKey: "\(TasksProfileResolver.verificationBundleIdentifierPrefix)"],
            [:],
        ]
        for invalidInfo in invalidBundles {
            expectFailure(TasksFailure.invalidProfile) {
                try TasksProfileResolver.resolve(bundleInfo: invalidInfo, environment: [:],
                                                  applicationSupport: productionSupport)
            }
            precondition(!FileManager.default.fileExists(atPath: productionSupport.path),
                         "invalid profile bindings must fail before creating production storage")
        }
        expectFailure(TasksFailure.invalidProfile) {
            try TasksProfileResolver.resolve(bundleInfo: [TasksProfileResolver.bundleIdentifierKey:
                TasksProfileResolver.productionBundleIdentifier],
                environment: [TasksProfileResolver.dataDirectoryEnvironmentKey: expected.path], applicationSupport: root)
        }
        let normal = try TasksProfileResolver.resolve(
            bundleInfo: [TasksProfileResolver.bundleIdentifierKey: TasksProfileResolver.productionBundleIdentifier],
            environment: [:], applicationSupport: root)
        guard case let .production(normalDirectory) = normal else { preconditionFailure() }
        precondition(normalDirectory.lastPathComponent == "Banana Tasks")

        let target = root.appendingPathComponent("real-data", isDirectory: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        let link = root.appendingPathComponent("linked-data", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
        expectFailure(TasksFailure.invalidProfile) { try TasksLocalDocumentStore(directory: link) }
    }

    private static func preferenceAndBridgeBoundaries() throws {
        let catalogJSON = """
        [{"id":"banana-light","name":"Light","appearance":"light","colors":{"paper":"#fffdf4"}},
         {"id":"banana-dark","name":"Dark","appearance":"dark","colors":{"paper":"#1c1a15"}}]
        """
        let catalog = try TasksThemeCatalog(data: Data(catalogJSON.utf8))
        precondition(catalog.identifiers == ["banana-light", "banana-dark"])
        let suiteName = "BananaTasksNativeTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let preferences = UserDefaultsTasksPreferences(defaults: defaults, catalog: catalog)
        precondition(preferences.load() == .defaults)
        let selected = TasksPreferences(appearanceTheme: "banana-dark", pinned: true, soundEnabled: true,
                                        motionEnabled: false, ripeningSpeed: .lively)
        let savedPreferences = try preferences.save(selected)
        precondition(savedPreferences == selected)
        precondition(preferences.load() == selected, "pin and companion preferences must persist independently")
        expectFailure(TasksFailure.invalidPreferences) {
            try preferences.save(TasksPreferences(appearanceTheme: "foreign-theme", pinned: false,
                soundEnabled: false, motionEnabled: true, ripeningSpeed: .normal))
        }

        if case .loadTasks = try TasksBridgeDecoder.decode(["action": "loadTasks"]) {} else { preconditionFailure() }
        let revision = TasksLocalDocumentStore.emptyRevision
        let document: [String: Any] = ["version": 1, "tasks": []]
        if case .saveTasks(let expected, _) = try TasksBridgeDecoder.decode(["action": "saveTasks", "expectedRevision": revision,
                                                                              "document": document]) {
            precondition(expected == revision)
        } else { preconditionFailure("valid storage commands decode into typed actions") }
        if case .hotkeyPreferences = try TasksBridgeDecoder.decode(["action": "hotkeyPreferences"]) {} else { preconditionFailure() }
        if case .resetHotkeyPreferences = try TasksBridgeDecoder.decode(["action": "resetHotkeyPreferences"]) {} else { preconditionFailure() }
        let cmdShift2: [String: Any] = ["keyCode": 19, "modifiers": TasksHotkeyChord.command | TasksHotkeyChord.shift]
        if case .setHotkey(let chord) = try TasksBridgeDecoder.decode(["action": "hotkeyPreferences", "shortcut": cmdShift2]) {
            precondition(chord.display == "⇧⌘2")
        } else { preconditionFailure("valid shortcut preferences decode into a typed command") }
        if case .setHotkeyRecording(true) = try TasksBridgeDecoder.decode(["action": "hotkeyPreferences", "recording": true]) {} else { preconditionFailure() }
        let invalid: [[String: Any]] = [
            ["action": "unknown"],
            ["action": "hotkeyPreferences", "shortcut": ["keyCode": 19, "modifiers": 768, "extra": true]],
            ["action": "hotkeyPreferences", "shortcut": ["keyCode": true, "modifiers": 768]],
            ["action": "hotkeyPreferences", "shortcut": ["keyCode": 19, "modifiers": 0]],
            ["action": "hotkeyPreferences", "shortcut": ["keyCode": 19, "modifiers": 768.5]],
            ["action": "hotkeyPreferences", "recording": 1],
            ["action": "hotkeyPreferences", "recording": true, "shortcut": cmdShift2],
            ["action": "resetHotkeyPreferences", "shortcut": cmdShift2],
            ["action": "loadTasks", "extra": true],
            ["action": "saveTasks", "expectedRevision": revision, "document": ["version": true, "tasks": []]],
            ["action": "saveTasks", "expectedRevision": "bad", "document": document],
            ["action": "savePreferences", "preferences": ["appearanceTheme": NSNull(), "pinned": NSNumber(value: 1),
                "soundEnabled": false, "motionEnabled": true, "ripeningSpeed": "normal"]],
            ["action": "connectTodoist", "token": "bad\ntoken"],
            ["action": "flushAcknowledged", "requestID": "not-a-uuid", "saved": true],
            ["action": "calendarAppointments", "start": true, "end": 2],
            ["action": "copyText", "text": "ok", "untrusted": true]
        ]
        for request in invalid { expectFailure(TasksFailure.invalidRequest) { try TasksBridgeDecoder.decode(request) } }
        precondition(!TasksBridgeDecoder.validDocument(["version": NSNumber(value: true), "tasks": []]))
        precondition(!TasksBridgeDecoder.validDocument(["version": 1, "tasks": [Date()]]))
    }

    @MainActor
    private static func hotkeyPreferencesAndRegistrationPolicy() throws {
        let primarySuiteName = "BananaTasksHotkeyPrimaryTest.\(UUID().uuidString)"
        let anotherSuiteName = "BananaTasksHotkeyOtherProfileTest.\(UUID().uuidString)"
        let verificationDefaults = UserDefaults(suiteName: primarySuiteName)!
        let anotherDefaults = UserDefaults(suiteName: anotherSuiteName)!
        defer {
            verificationDefaults.removePersistentDomain(forName: primarySuiteName)
            anotherDefaults.removePersistentDomain(forName: anotherSuiteName)
        }
        let catalog = try TasksThemeCatalog(data: Data("""
            [{"id":"banana-light","name":"Light","appearance":"light","colors":{"paper":"#fffdf4"}}]
            """.utf8))
        let taskPreferences = UserDefaultsTasksPreferences(defaults: verificationDefaults, catalog: catalog)
        let selectedTaskPreferences = TasksPreferences(appearanceTheme: "banana-light", pinned: true, soundEnabled: false,
                                                       motionEnabled: true, ripeningSpeed: .normal)
        _ = try taskPreferences.save(selectedTaskPreferences)
        let taskPreferencesBlob = verificationDefaults.data(forKey: "bananaTasks.preferences.v1")

        let hotkeyPreferences = UserDefaultsTasksHotkeyPreferences(defaults: verificationDefaults)
        let registrar = FakeTasksHotkeyRegistrar()
        let coordinator = TasksHotkeyCoordinator(preferences: hotkeyPreferences, registrar: registrar, registrationAllowed: true)
        let initial = coordinator.registerInitial()
        precondition(initial.registered && initial.available && initial.chord == .defaultChord)
        precondition(initial.chord.keyCode == 17 && initial.chord.modifiers == (TasksHotkeyChord.control | TasksHotkeyChord.option))
        precondition(initial.display == "⌃⌥T", "Tasks keeps its existing Control-Option-T default")
        precondition(taskPreferences.load() == selectedTaskPreferences &&
                     verificationDefaults.data(forKey: "bananaTasks.preferences.v1") == taskPreferencesBlob,
                     "the separate Tasks shortcut key must not modify the existing five-field preference blob")

        let cmdShift2 = try TasksHotkeyChord(keyCode: 19, modifiers: TasksHotkeyChord.command | TasksHotkeyChord.shift)
        registrar.failureFor = cmdShift2
        coordinator.setRecording(true)
        let failedReplacement = coordinator.set(cmdShift2)
        precondition(!coordinator.isRecording, "submitting a shortcut clears recorder suppression even on registration failure")
        var actionAfterFailedSet = 0
        coordinator.handleHotkey { actionAfterFailedSet += 1 }
        precondition(actionAfterFailedSet == 1, "a failed selection cannot strand the active callback in recording mode")
        precondition(failedReplacement.chord == .defaultChord && failedReplacement.registered && failedReplacement.available)
        precondition(failedReplacement.error == .registrationFailed && registrar.activeChord == .defaultChord,
                     "failed replacement leaves the prior global binding confirmed")
        precondition(hotkeyPreferences.load() == .defaultChord,
                     "failed registration must not persist the requested shortcut")

        coordinator.setRecording(true)
        var actionCount = 0
        coordinator.handleHotkey { actionCount += 1 }
        precondition(actionCount == 0, "the existing OS binding is suppressed while the recorder is listening")
        coordinator.setRecording(false)
        coordinator.handleHotkey { actionCount += 1 }
        precondition(actionCount == 1, "ending recording restores the existing shortcut callback")

        registrar.failureFor = nil
        let selectedHotkey = coordinator.set(cmdShift2)
        precondition(selectedHotkey.registered && selectedHotkey.chord == cmdShift2 && selectedHotkey.display == "⇧⌘2")
        precondition(hotkeyPreferences.load() == cmdShift2)
        precondition(taskPreferences.load() == selectedTaskPreferences &&
                     verificationDefaults.data(forKey: "bananaTasks.preferences.v1") == taskPreferencesBlob)
        registrar.failureFor = .defaultChord
        coordinator.setRecording(true)
        let failedReset = coordinator.reset()
        precondition(!coordinator.isRecording && failedReset.chord == cmdShift2 && failedReset.registered &&
                     failedReset.error == .registrationFailed && hotkeyPreferences.load() == cmdShift2,
                     "a failed reset clears recorder suppression and preserves the confirmed shortcut")
        registrar.failureFor = nil
        coordinator.setRecording(true)
        let resetHotkey = coordinator.reset()
        precondition(!coordinator.isRecording, "reset clears recorder suppression regardless of registration outcome")
        precondition(resetHotkey.registered && resetHotkey.chord == .defaultChord && resetHotkey.display == "⌃⌥T")
        precondition(hotkeyPreferences.load() == .defaultChord, "native reset restores and persists the native default")

        let otherProfilePreferences = UserDefaultsTasksHotkeyPreferences(defaults: anotherDefaults)
        precondition(otherProfilePreferences.load() == .defaultChord,
                     "shortcut preferences stay within the selected UserDefaults profile suite")
        let blockedRegistrar = FakeTasksHotkeyRegistrar()
        let verificationCoordinator = TasksHotkeyCoordinator(preferences: otherProfilePreferences,
                                                              registrar: blockedRegistrar, registrationAllowed: false)
        let verificationState = verificationCoordinator.registerInitial()
        let verificationSelection = verificationCoordinator.set(cmdShift2)
        precondition(verificationState.error == .verificationProfile && !verificationState.registered)
        precondition(verificationSelection.error == .verificationProfile && blockedRegistrar.registrationCalls == 0,
                     "verification profiles cannot register real global shortcuts")
        precondition(anotherDefaults.object(forKey: UserDefaultsTasksHotkeyPreferences.defaultsKey) == nil,
                     "a verification shortcut choice is not written as confirmed")

        let conflictSuiteName = "BananaTasksHotkeyConflictTest.\(UUID().uuidString)"
        let conflictDefaults = UserDefaults(suiteName: conflictSuiteName)!
        defer { conflictDefaults.removePersistentDomain(forName: conflictSuiteName) }
        let conflictPreferences = UserDefaultsTasksHotkeyPreferences(defaults: conflictDefaults)
        let conflictRegistrar = FakeTasksHotkeyRegistrar()
        conflictRegistrar.failureFor = .defaultChord
        let conflictCoordinator = TasksHotkeyCoordinator(preferences: conflictPreferences, registrar: conflictRegistrar,
                                                         registrationAllowed: true)
        let initialConflict = conflictCoordinator.registerInitial()
        precondition(!initialConflict.registered && initialConflict.available && initialConflict.error == .registrationFailed,
                     "a default shortcut conflict leaves shortcut recording available")
        precondition(conflictDefaults.object(forKey: UserDefaultsTasksHotkeyPreferences.defaultsKey) == nil,
                     "an unregistered fresh-install default is not persisted")
        conflictRegistrar.failureFor = nil
        conflictCoordinator.setRecording(true)
        let recovered = conflictCoordinator.set(cmdShift2)
        precondition(!conflictCoordinator.isRecording && recovered.registered && recovered.available && recovered.chord == cmdShift2)
        precondition(conflictPreferences.load() == cmdShift2,
                     "a user can recover from the initial conflict with a confirmed replacement")

        let unavailableSuiteName = "BananaTasksHotkeyUnavailableTest.\(UUID().uuidString)"
        let unavailableDefaults = UserDefaults(suiteName: unavailableSuiteName)!
        defer { unavailableDefaults.removePersistentDomain(forName: unavailableSuiteName) }
        let unavailableRegistrar = FakeTasksHotkeyRegistrar()
        unavailableRegistrar.failureFor = .defaultChord
        unavailableRegistrar.failureError = .registrationUnavailable
        let unavailableCoordinator = TasksHotkeyCoordinator(
            preferences: UserDefaultsTasksHotkeyPreferences(defaults: unavailableDefaults),
            registrar: unavailableRegistrar, registrationAllowed: true)
        let unavailableState = unavailableCoordinator.registerInitial()
        precondition(!unavailableState.registered && !unavailableState.available && unavailableState.error == .registrationUnavailable)

        var released: [Int] = []
        let failedPolicyReplacement = TasksHotkeyReplacementPolicy.replace(current: 7, create: { nil }, release: { released.append($0) })
        precondition(failedPolicyReplacement.handle == 7 && !failedPolicyReplacement.replaced && released.isEmpty)
        let successfulPolicyReplacement = TasksHotkeyReplacementPolicy.replace(current: 7, create: { 8 }, release: { released.append($0) })
        precondition(successfulPolicyReplacement.handle == 8 && successfulPolicyReplacement.replaced && released == [7])
    }

    @MainActor
    private final class FakeTasksHotkeyRegistrar: TasksHotkeyRegistrationPort {
        private(set) var activeChord: TasksHotkeyChord?
        private(set) var activeHandle: Int?
        private var nextHandle = 1
        private(set) var registrationCalls = 0
        var failureFor: TasksHotkeyChord?
        var failureError: TasksHotkeyError = .registrationFailed
        private(set) var releasedHandles: [Int] = []

        func register(_ chord: TasksHotkeyChord) -> TasksHotkeyRegistration {
            registrationCalls += 1
            let replacement = TasksHotkeyReplacementPolicy.replace(current: activeHandle, create: {
                guard chord != self.failureFor else { return nil }
                defer { self.nextHandle += 1 }
                return self.nextHandle
            }, release: { self.releasedHandles.append($0) })
            guard replacement.replaced, let handle = replacement.handle else {
                return TasksHotkeyRegistration(activeChord: activeChord, error: failureError)
            }
            activeHandle = handle
            activeChord = chord
            return TasksHotkeyRegistration(activeChord: chord, error: nil)
        }

        func unregister() { activeChord = nil; activeHandle = nil }
    }

    private static func focusAndFlushTransitions() {
        var focus = TasksFocusState()
        precondition(!focus.update(isKeyWindow: false, at: 1) && focus.lossDeadline == nil)
        precondition(focus.update(isKeyWindow: true, at: 2))
        precondition(!focus.update(isKeyWindow: false, at: 10) && focus.lossDeadline == 10.5)
        precondition(!focus.settle(at: 10.499))
        precondition(!focus.update(isKeyWindow: true, at: 10.499) && focus.lossDeadline == nil)
        precondition(!focus.settle(at: 10.5), "a cancelled timer cannot commit after focus returns")
        precondition(!focus.update(isKeyWindow: false, at: 11))
        precondition(focus.settle(at: 11.5) && !focus.isFocused)

        var flush = TasksFlushState()
        let request = UUID().uuidString.lowercased()
        precondition(flush.begin(request))
        precondition(!flush.begin(UUID().uuidString.lowercased()), "only one flush may be outstanding")
        precondition(flush.acknowledge(requestID: UUID().uuidString.lowercased(), saved: true) == nil,
                     "stale flush acknowledgements cannot dismiss the window")
        precondition(flush.acknowledge(requestID: request, saved: false) == false,
                     "save failure explicitly blocks dismissal")
        let retry = UUID().uuidString.lowercased()
        precondition(flush.begin(retry) && flush.acknowledge(requestID: retry, saved: true) == true)
    }

    private static func todoistIsolationAndPagination() async throws {
        let initial = TodoistCredential(token: "old-token", accountID: "old-account", projectID: "old-project")
        let credentials = MemoryTodoistCredentialStore(initial: initial)
        let completedRequestID = UUID().uuidString.lowercased()
        let http = MockTasksHTTPClient([
            response(["id": "new-account"]),
            response(["results": [["id": "project-old", "name": "Old project"]], "next_cursor": "page-2"]),
            response(["results": [["id": "project-new", "name": "Inbox"]], "next_cursor": NSNull()]),
            response(["results": [["id": "project-new", "name": "Inbox"]], "next_cursor": NSNull()]),
            response(["results": [["id": "task-1", "project_id": "project-new", "content": "synthetic task",
                                   "description": "synthetic note", "labels": ["planning"], "priority": 4,
                                   "added_at": "2024-03-01T12:00:00.123456Z"]], "next_cursor": "task-page-2"]),
            response(["results": [], "next_cursor": NSNull()]),
            response(["sync_status": [completedRequestID: "ok"]])
        ])
        let adapter = TodoistAdapter(credentials: credentials, http: http)
        let (connection, projects) = try await adapter.connect(token: "new-token")
        precondition(connection == .connected(accountID: "new-account", projectID: nil))
        precondition(projects.map(\.id) == ["project-old", "project-new"], "all project pages must be returned")
        precondition(credentials.value?.token == "new-token" && credentials.value?.accountID == "new-account")
        precondition(credentials.value?.projectID == nil, "reconnect to another account clears the old account project")
        precondition(http.requests[0].url?.absoluteString == "https://api.todoist.com/api/v1/user")
        precondition(http.requests[1].url?.path == "/api/v1/projects")
        precondition(URLComponents(url: http.requests[2].url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value == "page-2")

        _ = try await adapter.selectProject("project-new")
        let captures = try await adapter.captures()
        precondition(captures.count == 1, "task pagination must not silently truncate")
        precondition(captures[0].source == TodoistReference(accountID: "new-account", projectID: "project-new", taskID: "task-1"))
        precondition(captures[0].title == "synthetic task" && captures[0].notes == "synthetic note")
        precondition(captures[0].tags == ["planning"] && captures[0].priority == .high && captures[0].createdAt != nil)
        let createdAt = captures[0].createdAt!
        precondition(createdAt == 1_709_294_400_123 && createdAt.isFinite && createdAt.rounded() == createdAt &&
                     abs(createdAt) <= 9_007_199_254_740_991,
                     "fractional Todoist timestamps normalize to safe integer milliseconds")

        let beforeRejects = http.requests.count
        do {
            try await adapter.setCompleted(source: TodoistReference(accountID: "old-account", projectID: "old-project", taskID: "old-task"),
                                           completed: true, operationID: completedRequestID)
            preconditionFailure("a task from the previous account must fail closed")
        } catch is TasksFailure {}
        do {
            try await adapter.setCompleted(source: TodoistReference(accountID: "new-account", projectID: "other-project", taskID: "task-1"),
                                           completed: true, operationID: completedRequestID)
            preconditionFailure("a task from another project must fail closed")
        } catch is TasksFailure {}
        precondition(http.requests.count == beforeRejects, "cross-account/project rejection must happen before HTTP")

        try await adapter.setCompleted(source: captures[0].source, completed: true, operationID: completedRequestID)
        let mutation = http.requests.last!
        assertSyncRequest(mutation, token: "new-token")
        let command = try syncCommand(in: mutation)
        precondition(Set(command.keys) == Set(["type", "uuid", "args"]))
        precondition(command["type"] as? String == "item_close")
        precondition(command["uuid"] as? String == completedRequestID)
        precondition((command["args"] as? [String: Any])?["id"] as? String == "task-1")
    }

    private static func todoistCredentialLifecycle() async throws {
        let pendingConnectStore = MemoryTodoistCredentialStore()
        let pendingConnectHTTP = DeferredTasksHTTPClient()
        let pendingConnectAdapter = TodoistAdapter(credentials: pendingConnectStore, http: pendingConnectHTTP)
        let pendingConnect = Task { try await pendingConnectAdapter.connect(token: "pending-token") }
        _ = await pendingConnectHTTP.waitForRequest(at: 0)
        await pendingConnectHTTP.respond(at: 0, with: response(["id": "pending-account"]))
        _ = await pendingConnectHTTP.waitForRequest(at: 1)
        try pendingConnectAdapter.disconnect()
        await pendingConnectHTTP.respond(at: 1, with: response(["results": [], "next_cursor": NSNull()]))
        do {
            _ = try await pendingConnect.value
            preconditionFailure("disconnect must invalidate an in-flight connect")
        } catch let failure as TasksFailure {
            precondition(failure.localizedDescription == TasksFailure.todoistRejected.localizedDescription)
        }
        let pendingCredential = try pendingConnectStore.read()
        precondition(pendingCredential == nil, "pending connect must not resurrect credentials after disconnect")

        let orderedStore = MemoryTodoistCredentialStore()
        let orderedHTTP = DeferredTasksHTTPClient()
        let orderedAdapter = TodoistAdapter(credentials: orderedStore, http: orderedHTTP)
        let olderConnect = Task { try await orderedAdapter.connect(token: "older-token") }
        _ = await orderedHTTP.waitForRequest(at: 0)
        await orderedHTTP.respond(at: 0, with: response(["id": "older-account"]))
        _ = await orderedHTTP.waitForRequest(at: 1)
        let newerConnect = Task { try await orderedAdapter.connect(token: "newer-token") }
        _ = await orderedHTTP.waitForRequest(at: 2)
        await orderedHTTP.respond(at: 2, with: response(["id": "newer-account"]))
        _ = await orderedHTTP.waitForRequest(at: 3)
        await orderedHTTP.respond(at: 3, with: response(["results": [["id": "new-project", "name": "New"]],
                                                        "next_cursor": NSNull()]))
        let newerResult = try await newerConnect.value
        precondition(newerResult.0 == .connected(accountID: "newer-account", projectID: nil))
        await orderedHTTP.respond(at: 1, with: response(["results": [["id": "old-project", "name": "Old"]],
                                                        "next_cursor": NSNull()]))
        do {
            _ = try await olderConnect.value
            preconditionFailure("an older pending connect must not overwrite a newer connect")
        } catch let failure as TasksFailure {
            precondition(failure.localizedDescription == TasksFailure.todoistRejected.localizedDescription)
        }
        precondition(orderedStore.value == TodoistCredential(token: "newer-token", accountID: "newer-account", projectID: nil),
                     "the newest connect intent must own the credential state")

        let changedStore = MemoryTodoistCredentialStore(initial:
            TodoistCredential(token: "old-token", accountID: "old-account", projectID: nil))
        let oldHTTP = DeferredTasksHTTPClient()
        let oldAdapter = TodoistAdapter(credentials: changedStore, http: oldHTTP)
        let pendingSelection = Task { try await oldAdapter.selectProject("old-project") }
        _ = await oldHTTP.waitForRequest(at: 0)
        let externalCredential = TodoistCredential(token: "external-token", accountID: "current-account", projectID: "current-project")
        try changedStore.write(externalCredential)
        await oldHTTP.respond(at: 0, with: response(["results": [["id": "old-project", "name": "Old"]],
                                                     "next_cursor": NSNull()]))
        do {
            _ = try await pendingSelection.value
            preconditionFailure("a project response based on a stale credential snapshot must be rejected")
        } catch let failure as TasksFailure {
            precondition(failure.localizedDescription == TasksFailure.todoistRejected.localizedDescription)
        }
        precondition(changedStore.value == externalCredential,
                     "an external credential update must survive an older project response")

        let sharedStore = MemoryTodoistCredentialStore(initial:
            TodoistCredential(token: "account-a-token", accountID: "account-a", projectID: nil))
        let slowHTTP = DeferredTasksHTTPClient()
        let slowAdapter = TodoistAdapter(credentials: sharedStore, http: slowHTTP)
        let pendingOldSelection = Task { try await slowAdapter.selectProject("a-project") }
        _ = await slowHTTP.waitForRequest(at: 0)
        let newerAdapter = TodoistAdapter(credentials: sharedStore, http: MockTasksHTTPClient([
            response(["id": "account-b"]),
            response(["results": [["id": "b-project", "name": "B"]], "next_cursor": NSNull()]),
        ]))
        _ = try await newerAdapter.connect(token: "account-b-token")
        await slowHTTP.respond(at: 0, with: response(["results": [["id": "a-project", "name": "A"]],
                                                       "next_cursor": NSNull()]))
        do {
            _ = try await pendingOldSelection.value
            preconditionFailure("another adapter's newer account must invalidate an old project response")
        } catch let failure as TasksFailure {
            precondition(failure.localizedDescription == TasksFailure.todoistRejected.localizedDescription)
        }
        precondition(sharedStore.value == TodoistCredential(token: "account-b-token", accountID: "account-b", projectID: nil),
                     "an old account's project list must not overwrite the current account")

        let staleReadStore = MemoryTodoistCredentialStore(initial:
            TodoistCredential(token: "read-token", accountID: "read-account", projectID: "read-project"))
        let staleReadHTTP = DeferredTasksHTTPClient()
        let staleReadAdapter = TodoistAdapter(credentials: staleReadStore, http: staleReadHTTP)
        let pendingCaptures = Task { try await staleReadAdapter.captures() }
        _ = await staleReadHTTP.waitForRequest(at: 0)
        try staleReadAdapter.disconnect()
        await staleReadHTTP.respond(at: 0, with: response(["results": [], "next_cursor": NSNull()]))
        do {
            _ = try await pendingCaptures.value
            preconditionFailure("captures from a disconnected credential snapshot must not be imported")
        } catch let failure as TasksFailure {
            precondition(failure.localizedDescription == TasksFailure.todoistDisconnected.localizedDescription)
        }

        let staleWriteStore = MemoryTodoistCredentialStore(initial:
            TodoistCredential(token: "write-token", accountID: "write-account", projectID: "write-project"))
        let staleWriteHTTP = DeferredTasksHTTPClient()
        let staleWriteAdapter = TodoistAdapter(credentials: staleWriteStore, http: staleWriteHTTP)
        let operationID = UUID().uuidString.lowercased()
        let pendingCompletion = Task {
            try await staleWriteAdapter.setCompleted(
                source: TodoistReference(accountID: "write-account", projectID: "write-project", taskID: "task-1"),
                completed: true, operationID: operationID)
        }
        _ = await staleWriteHTTP.waitForRequest(at: 0)
        try staleWriteAdapter.disconnect()
        await staleWriteHTTP.respond(at: 0, with: response(["sync_status": [operationID: "ok"]]))
        do {
            try await pendingCompletion.value
            preconditionFailure("a completion response after disconnect must not consume its local retry intent")
        } catch let failure as TasksFailure {
            precondition(failure.localizedDescription == TasksFailure.todoistDisconnected.localizedDescription)
        }
    }

    private static func todoistCompletionSyncIdempotency() async throws {
        let credential = TodoistCredential(token: "synthetic-token", accountID: "account-1", projectID: "project-1")
        let credentials = MemoryTodoistCredentialStore(initial: credential)
        let completedID = "a5a5a5a5-1111-4111-8111-a5a5a5a5a5a5"
        let uncompletedID = "B6B6B6B6-2222-4222-8222-B6B6B6B6B6B6"
        let http = MockTasksHTTPClient([
            response(["sync_status": [completedID: "ok"]]),
            response(["sync_status": [completedID: "ok"]]),
            response(["sync_status": [uncompletedID: "ok"]])
        ])
        let adapter = TodoistAdapter(credentials: credentials, http: http)
        let source = TodoistReference(accountID: "account-1", projectID: "project-1", taskID: "task-1")

        try await adapter.setCompleted(source: source, completed: true, operationID: completedID)
        try await adapter.setCompleted(source: source, completed: true, operationID: completedID)
        try await adapter.setCompleted(source: source, completed: false, operationID: uncompletedID)

        precondition(http.requests.count == 3)
        for request in http.requests { assertSyncRequest(request, token: "synthetic-token") }
        let closeCommands = try http.requests.prefix(2).map(syncCommand(in:))
        let reopenCommand = try syncCommand(in: http.requests[2])
        for command in closeCommands {
            precondition(Set(command.keys) == Set(["type", "uuid", "args"]))
            precondition(Set((command["args"] as? [String: Any] ?? [:]).keys) == ["id"])
            precondition(command["type"] as? String == "item_close")
            precondition(command["uuid"] as? String == completedID, "retries must reuse the persisted command UUID verbatim")
            precondition((command["args"] as? [String: Any])?["id"] as? String == "task-1")
        }
        precondition(Set(reopenCommand.keys) == Set(["type", "uuid", "args"]))
        precondition(Set((reopenCommand["args"] as? [String: Any] ?? [:]).keys) == ["id"])
        precondition(reopenCommand["type"] as? String == "item_uncomplete")
        precondition(reopenCommand["uuid"] as? String == uncompletedID, "the sync UUID is preserved exactly")
        precondition((reopenCommand["args"] as? [String: Any])?["id"] as? String == "task-1")

        try await expectTodoistCommandRejected(
            response(["sync_status": [completedID: "error: synthetic provider detail"]]),
            operationID: completedID, forbiddenText: "synthetic provider detail")
        try await expectTodoistCommandRejected(response(["sync_status": [:]]), operationID: completedID)
        try await expectTodoistCommandRejected(response(["sync_status": "ok"]), operationID: completedID)
        try await expectTodoistCommandRejected(response(["sync_status": [completedID: true]]), operationID: completedID)
    }

    private static func calendarConsentAndIdempotency() async throws {
        let now = 1_700_000_000_000.0
        let clock = FixedTasksClock(now)
        let gateway = MemoryEventKitGateway()
        gateway.currentAuthorization = .denied
        let adapter = CalendarAdapter(gateway: gateway, clock: clock)
        precondition(adapter.authorization() == .denied && gateway.requestCount == 0, "status reads never trigger consent")
        expectFailure(TasksFailure.calendarDenied) { try adapter.calendars() }
        precondition(gateway.requestCount == 0, "calendar reads without consent never prompt")

        gateway.currentAuthorization = .notDetermined
        let requestedAuthorization = await adapter.requestAccess()
        precondition(requestedAuthorization == .authorized && gateway.requestCount == 1,
                     "only explicit access requests call the permission boundary")
        gateway.availableCalendars = [
            CalendarGatewayCalendar(id: "writable", title: String(repeating: "🧠", count: 513),
                                    sourceTitle: String(repeating: "S", count: 513), writable: true),
            CalendarGatewayCalendar(id: "readonly", title: "Shared", sourceTitle: "Remote", writable: false)
        ]
        let calendars = try adapter.calendars()
        precondition(calendars[0].title == String(repeating: "🧠", count: 256) && calendars[0].title.utf16.count == 512)
        precondition(calendars[0].sourceTitle.utf16.count == 512, "calendar display labels are bounded in UTF-16 units")

        let queryEnd = now + 60 * 60 * 1_000
        let firstMarker = URL(string: "https://example.invalid/events/first")!
        let secondMarker = URL(string: "https://example.invalid/events/second")!
        gateway.storedEvents = [
            (CalendarGatewayEvent(id: "event-1", title: String(repeating: "🧠", count: 501),
                                  start: now + 60_000.49, end: now + 120_000.49, allDay: false), firstMarker, "writable"),
            (CalendarGatewayEvent(id: "event-2", title: "Overlapping event", start: now + 90_000,
                                  end: now + 180_000, allDay: false), secondMarker, "writable")
        ]
        let appointments = try adapter.appointments(start: now, end: queryEnd)
        precondition(appointments.count == 2, "valid overlapping appointments remain separate rows")
        precondition(appointments[0].start == now + 60_000 && appointments[0].end == now + 120_000,
                     "fractional EventKit milliseconds normalize to safe integer milliseconds")
        precondition(appointments[0].title.utf16.count == 1_000, "appointment display titles fit the web contract")
        precondition(appointments[0].start < appointments[1].end && appointments[1].start < appointments[0].end)

        gateway.storedEvents = [
            (CalendarGatewayEvent(id: "unsafe-time", title: "Invalid", start: -9_007_199_254_740_992,
                                  end: now + 1_000, allDay: false), firstMarker, "writable")
        ]
        expectFailure(TasksFailure.calendarUnavailable) { try adapter.appointments(start: now, end: queryEnd) }
        gateway.storedEvents = [
            (CalendarGatewayEvent(id: "zero-span", title: "Invalid", start: now + 1_000.1,
                                  end: now + 1_000.4, allDay: false), firstMarker, "writable")
        ]
        expectFailure(TasksFailure.calendarUnavailable) { try adapter.appointments(start: now, end: queryEnd) }
        gateway.storedEvents = [
            (CalendarGatewayEvent(id: String(repeating: "i", count: 129), title: "Invalid", start: now + 1_000,
                                  end: now + 2_000, allDay: false), firstMarker, "writable")
        ]
        expectFailure(TasksFailure.calendarUnavailable) { try adapter.appointments(start: now, end: queryEnd) }
        gateway.availableCalendars[0] = CalendarGatewayCalendar(id: String(repeating: "c", count: 129),
            title: "Unrepresentable identity", sourceTitle: "Local", writable: true)
        expectFailure(TasksFailure.calendarUnavailable) { try adapter.calendars() }
        gateway.availableCalendars = (0..<501).map { index in
            CalendarGatewayCalendar(id: "calendar-\(index)", title: "Calendar", sourceTitle: "Local", writable: true)
        }
        expectFailure(TasksFailure.calendarUnavailable) { try adapter.calendars() }
        gateway.availableCalendars = [
            CalendarGatewayCalendar(id: "writable", title: "Synthetic", sourceTitle: "Local", writable: true),
            CalendarGatewayCalendar(id: "readonly", title: "Shared", sourceTitle: "Remote", writable: false)
        ]

        gateway.storedEvents = []
        let blockStart = now + 30 * 60 * 1_000
        let draft = CalendarBlockDraft(blockID: UUID().uuidString.lowercased(), taskID: "synthetic-task",
                                       title: "Synthetic planning block", start: blockStart,
                                       end: blockStart + 60 * 60 * 1_000, calendarID: "writable")
        let sameMillisecondDraft = CalendarBlockDraft(blockID: UUID().uuidString.lowercased(), taskID: "task",
            title: "Current millisecond", start: now, end: now + 60_000, calendarID: "writable")
        try CalendarBlockPolicy.validate(sameMillisecondDraft, now: now + 0.75)
        let receipt1 = try adapter.createBlock(draft)
        let receipt2 = try adapter.createBlock(draft)
        precondition(receipt1 == receipt2 && gateway.writeCount == 1, "retry markers prevent duplicate events")

        let existingStart = now + 2 * 60 * 60 * 1_000
        let existingDraft = CalendarBlockDraft(blockID: UUID().uuidString.lowercased(), taskID: "synthetic-task",
            title: "Existing block", start: existingStart, end: existingStart + 60_000, calendarID: "writable")
        let existingMarker = CalendarBlockPolicy.markerURL(blockID: existingDraft.blockID)!
        gateway.storedEvents.append((CalendarGatewayEvent(id: "existing-event", title: existingDraft.title,
            start: existingDraft.start + 0.49, end: existingDraft.end - 0.49, allDay: false), existingMarker, "writable"))
        let normalizedReceipt = try adapter.createBlock(existingDraft)
        precondition(normalizedReceipt.start == existingDraft.start && normalizedReceipt.end == existingDraft.end &&
                     normalizedReceipt.id == "existing-event" && gateway.writeCount == 1,
                     "existing receipts normalize before crossing the bridge")

        let longReceiptDraft = CalendarBlockDraft(blockID: UUID().uuidString.lowercased(), taskID: "synthetic-task",
            title: "Existing block", start: existingStart + 120_000, end: existingStart + 180_000, calendarID: "writable")
        let longReceiptMarker = CalendarBlockPolicy.markerURL(blockID: longReceiptDraft.blockID)!
        gateway.storedEvents.append((CalendarGatewayEvent(id: String(repeating: "r", count: 129), title: "Existing block",
            start: longReceiptDraft.start, end: longReceiptDraft.end, allDay: false), longReceiptMarker, "writable"))
        expectFailure(TasksFailure.calendarWriteFailed) { try adapter.createBlock(longReceiptDraft) }

        let readOnlyDraft = CalendarBlockDraft(blockID: UUID().uuidString.lowercased(), taskID: "task", title: "Block",
                                               start: blockStart, end: blockStart + 60_000, calendarID: "readonly")
        expectFailure(TasksFailure.invalidCalendarBlock) { try adapter.createBlock(readOnlyDraft) }
        let pastDraft = CalendarBlockDraft(blockID: UUID().uuidString.lowercased(), taskID: "task", title: "Past block",
            start: now - 30 * 60 * 1_000, end: now - 29 * 60 * 1_000, calendarID: "writable")
        expectFailure(TasksFailure.invalidCalendarBlock) { try adapter.createBlock(pastDraft) }
        let tooLong = CalendarBlockDraft(blockID: UUID().uuidString.lowercased(), taskID: "task", title: "Block",
            start: blockStart, end: blockStart + CalendarBlockPolicy.maximumDurationMilliseconds + 1, calendarID: "writable")
        expectFailure(TasksFailure.invalidCalendarBlock) { try adapter.createBlock(tooLong) }
        let fractionalDraft = CalendarBlockDraft(blockID: UUID().uuidString.lowercased(), taskID: "task", title: "Block",
            start: blockStart + 0.5, end: blockStart + 60_000, calendarID: "writable")
        expectFailure(TasksFailure.invalidCalendarBlock) { try adapter.createBlock(fractionalDraft) }
        let zeroSpanDraft = CalendarBlockDraft(blockID: UUID().uuidString.lowercased(), taskID: "task", title: "Block",
            start: blockStart, end: blockStart, calendarID: "writable")
        expectFailure(TasksFailure.invalidCalendarBlock) { try adapter.createBlock(zeroSpanDraft) }
        let unsafeDraft = CalendarBlockDraft(blockID: UUID().uuidString.lowercased(), taskID: "task", title: "Block",
            start: Double.greatestFiniteMagnitude, end: Double.greatestFiniteMagnitude, calendarID: "writable")
        expectFailure(TasksFailure.invalidCalendarBlock) { try adapter.createBlock(unsafeDraft) }
        let longCalendarIDDraft = CalendarBlockDraft(blockID: UUID().uuidString.lowercased(), taskID: "task", title: "Block",
            start: blockStart, end: blockStart + 60_000, calendarID: String(repeating: "c", count: 129))
        expectFailure(TasksFailure.invalidCalendarBlock) { try adapter.createBlock(longCalendarIDDraft) }
        expectFailure(TasksFailure.invalidCalendarRange) {
            try adapter.appointments(start: now - CalendarBlockPolicy.maximumRangeMilliseconds - 1, end: now)
        }
        precondition(gateway.writeCount == 1, "invalid, past, oversized and read-only requests never mutate events")
    }

    private static func verificationEffectsAreDisabled() async throws {
        let todoist = VerificationTodoistPort()
        let verificationConnection = try await todoist.connection()
        precondition(verificationConnection == .disconnected)
        do {
            _ = try await todoist.connect(token: "synthetic-token")
            preconditionFailure("verification mode must not connect to Todoist")
        } catch let failure as TasksFailure {
            precondition(failure.localizedDescription == TasksFailure.unavailable.localizedDescription)
        }
        let calendar = VerificationCalendarPort()
        precondition(calendar.authorization() == .unavailable)
        let verificationAuthorization = await calendar.requestAccess()
        precondition(verificationAuthorization == .unavailable, "verification must not prompt for calendar access")
        expectFailure(TasksFailure.calendarUnavailable) { try calendar.calendars() }
        try VerificationClipboard().copy("synthetic clipboard text")
    }

    private static func bridgeOriginPolicy() throws {
        let root = try temporaryDirectory("TasksBridge")
        defer { try? FileManager.default.removeItem(at: root) }
        let index = root.appendingPathComponent("tasks.html")
        try Data("synthetic".utf8).write(to: index)
        precondition(TasksBridgeSecurityPolicy.allows(isMainFrame: true, frameURL: index, bundledIndexURL: index))
        precondition(!TasksBridgeSecurityPolicy.allows(isMainFrame: false, frameURL: index, bundledIndexURL: index))
        precondition(!TasksBridgeSecurityPolicy.allows(isMainFrame: true, frameURL: URL(string: "https://example.invalid/tasks.html"), bundledIndexURL: index))
        precondition(!TasksBridgeSecurityPolicy.allows(isMainFrame: true, frameURL: root.appendingPathComponent("other.html"), bundledIndexURL: index))
    }

    private static func assertSyncRequest(_ request: URLRequest, token: String) {
        precondition(request.httpMethod == "POST")
        precondition(request.url?.absoluteString == "https://api.todoist.com/api/v1/sync")
        precondition(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(token)")
        precondition(request.value(forHTTPHeaderField: "Accept") == "application/json")
        precondition(request.value(forHTTPHeaderField: "Content-Type") == "application/x-www-form-urlencoded")
        precondition(request.value(forHTTPHeaderField: "X-Request-Id") == nil,
                     "Todoist sync command UUIDs belong in the body, not an invented replay header")
    }
    private static func syncCommand(in request: URLRequest) throws -> [String: Any] {
        guard let body = request.httpBody, let bodyString = String(data: body, encoding: .utf8),
              let components = URLComponents(string: "https://example.invalid/?\(bodyString)"),
              let items = components.queryItems, items.count == 1,
              items[0].name == "commands", let encodedCommands = items[0].value,
              let commands = try JSONSerialization.jsonObject(with: Data(encodedCommands.utf8)) as? [[String: Any]],
              commands.count == 1 else { throw TasksHTTPFailure.invalidResponse }
        return commands[0]
    }
    private static func expectTodoistCommandRejected(_ response: TasksHTTPResponse, operationID: String,
                                                     forbiddenText: String? = nil) async throws {
        let credentials = MemoryTodoistCredentialStore(initial:
            TodoistCredential(token: "synthetic-token", accountID: "account-1", projectID: "project-1"))
        let http = MockTasksHTTPClient([response])
        let adapter = TodoistAdapter(credentials: credentials, http: http)
        do {
            try await adapter.setCompleted(source: TodoistReference(accountID: "account-1", projectID: "project-1", taskID: "task-1"),
                                           completed: true, operationID: operationID)
            preconditionFailure("HTTP success without the exact sync command result must be rejected")
        } catch let failure as TasksFailure {
            precondition(failure.localizedDescription == TasksFailure.todoistRejected.localizedDescription)
            if let forbiddenText { precondition(!failure.localizedDescription.contains(forbiddenText)) }
        }
        precondition(http.requests.count == 1)
    }
    private static func response(_ value: Any, status: Int = 200) -> TasksHTTPResponse {
        TasksHTTPResponse(status: status, data: try! JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]))
    }
    private static func temporaryDirectory(_ prefix: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(prefix)-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
    private static func expectFailure<T>(_ expected: TasksFailure, _ operation: () throws -> T) {
        do { _ = try operation(); preconditionFailure("expected TasksFailure.\(expected)") }
        catch let failure as TasksFailure { precondition(failure.localizedDescription == expected.localizedDescription) }
        catch { preconditionFailure("unexpected error type: \(error)") }
    }
}

private struct FixedTasksClock: TasksClock {
    let value: Double
    init(_ value: Double) { self.value = value }
    func nowMilliseconds() -> Double { value }
}

private actor DeferredTasksHTTPClient: TasksHTTPClient {
    private struct PendingResponse {
        let maximumBytes: Int
        let continuation: CheckedContinuation<TasksHTTPResponse, Error>
    }

    private var requests: [URLRequest] = []
    private var responses: [Int: PendingResponse] = [:]
    private var requestWaiters: [(Int, CheckedContinuation<URLRequest, Never>)] = []

    func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> TasksHTTPResponse {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<TasksHTTPResponse, Error>) in
            let index = requests.count
            requests.append(request)
            responses[index] = PendingResponse(maximumBytes: maximumResponseBytes, continuation: continuation)
            var remaining: [(Int, CheckedContinuation<URLRequest, Never>)] = []
            for (requestedIndex, waiter) in requestWaiters {
                if requestedIndex < requests.count { waiter.resume(returning: requests[requestedIndex]) }
                else { remaining.append((requestedIndex, waiter)) }
            }
            requestWaiters = remaining
        }
    }

    func waitForRequest(at index: Int) async -> URLRequest {
        if index < requests.count { return requests[index] }
        return await withCheckedContinuation { continuation in
            requestWaiters.append((index, continuation))
        }
    }

    func respond(at index: Int, with response: TasksHTTPResponse) {
        guard let pending = responses.removeValue(forKey: index),
              response.data.count <= pending.maximumBytes else {
            preconditionFailure("response must match a pending bounded HTTP request")
        }
        pending.continuation.resume(returning: response)
    }
}

private final class MockTasksHTTPClient: TasksHTTPClient {
    private var responses: [TasksHTTPResponse]
    private(set) var requests: [URLRequest] = []
    init(_ responses: [TasksHTTPResponse]) { self.responses = responses }
    func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> TasksHTTPResponse {
        requests.append(request)
        guard !responses.isEmpty else { throw TasksHTTPFailure.invalidResponse }
        let response = responses.removeFirst()
        guard response.data.count <= maximumResponseBytes else { throw TasksHTTPFailure.tooLarge }
        return response
    }
}
