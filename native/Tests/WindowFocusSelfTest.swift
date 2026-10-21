import Foundation

@main
struct WindowFocusSelfTest {
    static func main() {
        var focus = WindowFocusState()
        precondition(!focus.isFocused && focus.lossDeadline == nil)
        precondition(!focus.update(isKeyWindow: false, at: 0), "inactive startup must not schedule a blur")
        precondition(focus.lossDeadline == nil)
        precondition(focus.update(isKeyWindow: true, at: 1), "activation is immediate")
        precondition(!focus.update(isKeyWindow: true, at: 2), "duplicate notifications do not republish focus")

        precondition(!focus.update(isKeyWindow: false, at: 10))
        precondition(focus.isFocused && focus.lossDeadline == 10.5)
        precondition(!focus.update(isKeyWindow: false, at: 10.499))
        precondition(focus.isFocused && focus.lossDeadline == 10.5, "repeated blur must not postpone the deadline")
        precondition(!focus.update(isKeyWindow: true, at: 10.499), "a short interruption never changes presentation")
        precondition(focus.isFocused && focus.lossDeadline == nil, "focus return cancels the pending loss")
        precondition(!focus.update(isKeyWindow: true, at: 10.5), "a stale timer must not dim an active window")

        precondition(!focus.update(isKeyWindow: false, at: 11))
        precondition(focus.lossDeadline == 11.5, "each new interruption gets a full grace period")
        precondition(focus.update(isKeyWindow: false, at: 11.5), "sustained blur commits exactly at 500 ms")
        precondition(!focus.isFocused && focus.lossDeadline == nil)
        precondition(!focus.update(isKeyWindow: false, at: 12), "settled blur must not schedule more work")
        precondition(focus.lossDeadline == nil)
        precondition(focus.update(isKeyWindow: true, at: 12.01), "refocus never waits for a debounce")

        for index in 0..<100 {
            let now = 20 + Double(index)
            precondition(!focus.update(isKeyWindow: false, at: now))
            precondition(!focus.update(isKeyWindow: true, at: now + 0.1))
            precondition(focus.isFocused && focus.lossDeadline == nil, "focus churn must not flash or hide the note")
        }
        precondition(!focus.update(isKeyWindow: false, at: 200))
        precondition(focus.update(isKeyWindow: false, at: 201), "a delayed run-loop callback still settles blur")
        precondition(focus.update(isKeyWindow: true, at: 202))
        precondition(!focus.update(isKeyWindow: false, at: 203))
        precondition(!focus.update(isKeyWindow: true, at: 204), "actual key-window state wins over an expired deadline")
        precondition(focus.isFocused && focus.lossDeadline == nil)
        print("Native window focus checks passed (500 ms grace, cancellation, sustained blur, immediate refocus, repeated interruptions)")
    }
}
