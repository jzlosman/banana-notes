#if canImport(Sparkle)
import Sparkle

@MainActor
final class UpdateController {
    private let controller: SPUStandardUpdaterController

    init() {
        controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: nil, userDriverDelegate: nil)
    }

    func checkForUpdates() {
        controller.startUpdater()
        controller.checkForUpdates(nil)
    }
}
#endif
