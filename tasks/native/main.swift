import AppKit

MainActor.assumeIsolated {
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    let delegate = TasksAppDelegate()
    application.delegate = delegate
    application.run()
}
