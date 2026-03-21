import Foundation

@MainActor
final class DashboardManager {
    static let shared = DashboardManager()

    private var windowController: DashboardWindowController?

    /// Last known dashboard session key, persisted so voice wake can send to
    /// the same chat even when the dashboard window is closed.
    private(set) var lastKnownSessionKey: String?

    private init() {
        self.lastKnownSessionKey = UserDefaults.standard.string(forKey: "argent.lastDashboardSessionKey")
    }

    func show(url: URL) {
        if let controller = self.windowController {
            if controller.dashboardURL != url {
                controller.load(url: url)
            }
            controller.show()
            return
        }

        let controller = DashboardWindowController(dashboardURL: url)
        self.windowController = controller
        controller.show()
    }

    func close() {
        self.windowController?.close()
        self.windowController = nil
    }

    func hasOpenWindow() -> Bool {
        self.windowController != nil
    }

    func activeSessionKey() async -> String? {
        guard let controller = self.windowController else { return nil }
        let key = await controller.activeSessionKey()
        if let key, !key.isEmpty {
            self.lastKnownSessionKey = key
            UserDefaults.standard.set(key, forKey: "argent.lastDashboardSessionKey")
        }
        return key
    }

    func latestAssistantMessage(sessionKey: String, since: Double? = nil) async -> (text: String, spokenSummary: String?, timestamp: Double?)? {
        guard let controller = self.windowController else { return nil }
        return await controller.latestAssistantMessage(sessionKey: sessionKey, since: since)
    }

    func attachTtsAudio(messageId: String, audioURL: String) async {
        guard let controller = self.windowController else { return }
        await controller.attachTtsAudio(messageId: messageId, audioURL: audioURL)
    }

    func setNativeVoiceSpeaking(_ speaking: Bool) async {
        guard let controller = self.windowController else { return }
        await controller.setNativeVoiceSpeaking(speaking)
    }

    func sendMessage(_ content: String) async -> (ok: Bool, sessionKey: String?, error: String?) {
        guard let controller = self.windowController else {
            return (false, nil, "dashboard-not-open")
        }
        return await controller.sendMessage(content)
    }
}
