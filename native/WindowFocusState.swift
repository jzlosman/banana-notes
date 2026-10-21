import Foundation

/// Presentation focus tolerates brief AppKit key-window interruptions.
/// The caller supplies monotonic time and owns scheduling and window effects.
struct WindowFocusState {
    static let lossDelay: TimeInterval = 0.5
    private(set) var isFocused = false
    private(set) var lossDeadline: TimeInterval?

    /// Returns true only when the presented focus state changes.
    @discardableResult
    mutating func update(isKeyWindow: Bool, at now: TimeInterval) -> Bool {
        let previous = isFocused
        if isKeyWindow {
            lossDeadline = nil
            isFocused = true
        } else if isFocused {
            if let deadline = lossDeadline {
                if now >= deadline {
                    lossDeadline = nil
                    isFocused = false
                }
            } else {
                lossDeadline = now + Self.lossDelay
            }
        }
        return previous != isFocused
    }
}
