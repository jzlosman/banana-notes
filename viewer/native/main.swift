import AppKit

MainActor.assumeIsolated {
    let application = NSApplication.shared
    application.setActivationPolicy(.regular)
    let delegate = ViewerAppDelegate()
    application.delegate = delegate
    application.run()
}
