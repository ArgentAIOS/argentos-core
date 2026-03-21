import AppKit
@preconcurrency import AVFoundation
import Foundation

@MainActor
final class ServiceManager: ObservableObject {
    @Published var services: [ServiceInfo] = ServiceInfo.defaultServices
    @Published var isChecking = false
    @Published var meetingIsBusy = false
    @Published var meetingIsRecording = false
    @Published var meetingStatusMessage = "Meeting capture idle"
    @Published var meetingLastResult: String?
    @Published var meetingErrorMessage: String?
    @Published var meetingAutoProcessOnStop: Bool {
        didSet { UserDefaults.standard.set(meetingAutoProcessOnStop, forKey: Self.meetingAutoProcessKey) }
    }
    @Published var meetingCreateTasksOnProcess: Bool {
        didSet { UserDefaults.standard.set(meetingCreateTasksOnProcess, forKey: Self.meetingCreateTasksKey) }
    }
    @Published var meetingLiveTranscriptOnStart: Bool {
        didSet { UserDefaults.standard.set(meetingLiveTranscriptOnStart, forKey: Self.meetingLiveTranscriptKey) }
    }
    @Published var meetingCaptureSystemAudioOnStart: Bool {
        didSet { UserDefaults.standard.set(meetingCaptureSystemAudioOnStart, forKey: Self.meetingCaptureSystemAudioKey) }
    }
    @Published var meetingCaptureMicOnStart: Bool {
        didSet { UserDefaults.standard.set(meetingCaptureMicOnStart, forKey: Self.meetingCaptureMicKey) }
    }
    @Published var meetingMicDevices: [MeetingMicDevice] = []
    @Published var meetingSelectedMicDeviceId: String {
        didSet { UserDefaults.standard.set(meetingSelectedMicDeviceId, forKey: Self.meetingSelectedMicDeviceKey) }
    }
    @Published var meetingMicPermission = "unknown"
    @Published var meetingScreenCapturePermission = false

    private let uid = getuid()
    private static let systemDefaultMicSelectionId = "default"
    private static let meetingAutoProcessKey = "argent.manager.meeting.autoProcessOnStop"
    private static let meetingCreateTasksKey = "argent.manager.meeting.createTasksOnProcess"
    private static let meetingLiveTranscriptKey = "argent.manager.meeting.liveTranscriptOnStart"
    private static let meetingCaptureSystemAudioKey = "argent.manager.meeting.captureSystemAudioOnStart"
    private static let meetingCaptureMicKey = "argent.manager.meeting.captureMicOnStart"
    private static let meetingSelectedMicDeviceKey = "argent.manager.meeting.selectedMicDeviceId"

    init() {
        meetingAutoProcessOnStop = UserDefaults.standard.object(
            forKey: Self.meetingAutoProcessKey) as? Bool ?? true
        meetingCreateTasksOnProcess = UserDefaults.standard.object(
            forKey: Self.meetingCreateTasksKey) as? Bool ?? false
        meetingLiveTranscriptOnStart = UserDefaults.standard.object(
            forKey: Self.meetingLiveTranscriptKey) as? Bool ?? true
        meetingCaptureSystemAudioOnStart = UserDefaults.standard.object(
            forKey: Self.meetingCaptureSystemAudioKey) as? Bool ?? true
        meetingCaptureMicOnStart = UserDefaults.standard.object(
            forKey: Self.meetingCaptureMicKey) as? Bool ?? true
        meetingSelectedMicDeviceId = UserDefaults.standard.string(forKey: Self.meetingSelectedMicDeviceKey)
            ?? Self.systemDefaultMicSelectionId
    }

    private var runtimeDir: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/.argentos/runtime"
    }
    private var bundledRuntimeDir: String? {
        guard let resourcePath = Bundle.main.resourcePath else { return nil }
        let candidate = "\(resourcePath)/argent-runtime"
        let node = "\(candidate)/bin/node"
        let script = "\(candidate)/argent.mjs"
        guard FileManager.default.isExecutableFile(atPath: node),
              FileManager.default.fileExists(atPath: script) else {
            return nil
        }
        return candidate
    }
    private var effectiveRuntimeDir: String {
        bundledRuntimeDir ?? runtimeDir
    }
    private var nodePath: String { "\(effectiveRuntimeDir)/bin/node" }
    private var agentScript: String { "\(effectiveRuntimeDir)/argent.mjs" }
    private let session = URLSession(configuration: {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 3
        config.timeoutIntervalForResource = 3
        return config
    }())

    private var guiDomain: String {
        "gui/\(uid)"
    }

    private struct MeetingToolError: Decodable {
        let message: String?
    }

    private struct MeetingToolResultText: Decodable {
        let type: String?
        let text: String?
    }

    private struct MeetingToolResultPayload: Decodable {
        let content: [MeetingToolResultText]?
    }

    private struct MeetingToolResponse: Decodable {
        let ok: Bool?
        let result: MeetingToolResultPayload?
        let error: MeetingToolError?
    }

    struct MeetingMicDevice: Identifiable, Hashable {
        let id: String
        let name: String
        let isDefault: Bool
    }

    private struct MeetingMicDevicePayload: Decodable {
        let id: String
        let name: String
        let isDefault: Bool?
    }

    private struct MeetingDevicesPayload: Decodable {
        let ok: Bool?
        let microphonePermission: String?
        let screenCapturePermission: Bool?
        let defaultMicDeviceId: String?
        let defaultMicDeviceName: String?
        let micDevices: [MeetingMicDevicePayload]?
    }

    private var bundledMeetingCaptureBinaryPath: String? {
        guard let resourcePath = Bundle.main.resourcePath else { return nil }
        let candidate = "\(resourcePath)/bin/argent-audio-capture"
        return FileManager.default.isExecutableFile(atPath: candidate) ? candidate : nil
    }

    var selectedMeetingMicLabel: String {
        if meetingSelectedMicDeviceId == Self.systemDefaultMicSelectionId {
            if let defaultMic = meetingMicDevices.first(where: { $0.isDefault }) {
                return "System Default (\(defaultMic.name))"
            }
            return "System Default"
        }
        if let selected = meetingMicDevices.first(where: { $0.id == meetingSelectedMicDeviceId }) {
            return selected.name
        }
        return "Selected Mic"
    }

    var meetingPermissionLabel: String {
        let micLabel: String
        switch meetingMicPermission {
        case "authorized":
            micLabel = "Mic granted"
        case "denied":
            micLabel = "Mic denied"
        case "restricted":
            micLabel = "Mic restricted"
        case "not_determined":
            micLabel = "Mic not requested"
        default:
            micLabel = "Mic unknown"
        }
        let screenLabel = meetingScreenCapturePermission ? "Screen granted" : "Screen missing"
        return "\(micLabel) • \(screenLabel)"
    }

    var meetingMicPermissionBlocked: Bool {
        let value = meetingMicPermission.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return value == "denied" || value == "restricted"
    }

    var meetingScreenPermissionBlocked: Bool {
        !meetingScreenCapturePermission
    }

    @discardableResult
    func openMeetingMicrophonePrivacySettings() -> Bool {
        let opened = openSystemSettingsURLCandidates([
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension",
        ])
        if !opened {
            _ = openSettingsPaneFallback(path: "/System/Library/PreferencePanes/Security.prefPane")
        }
        return opened
    }

    @discardableResult
    func openMeetingScreenPrivacySettings() -> Bool {
        let opened = openSystemSettingsURLCandidates([
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension",
        ])
        if !opened {
            _ = openSettingsPaneFallback(path: "/System/Library/PreferencePanes/Security.prefPane")
        }
        return opened
    }

    @discardableResult
    func openMeetingSoundInputSettings() -> Bool {
        let opened = openSystemSettingsURLCandidates([
            "x-apple.systempreferences:com.apple.preference.sound?input",
            "x-apple.systempreferences:com.apple.Sound-Settings.extension",
        ])
        if !opened {
            _ = openSettingsPaneFallback(path: "/System/Library/PreferencePanes/Sound.prefPane")
        }
        return opened
    }

    @discardableResult
    private func openSystemSettingsURLCandidates(_ candidates: [String]) -> Bool {
        for candidate in candidates {
            guard let url = URL(string: candidate) else { continue }
            if NSWorkspace.shared.open(url) {
                return true
            }
        }
        return false
    }

    @discardableResult
    private func openSettingsPaneFallback(path: String) -> Bool {
        guard FileManager.default.fileExists(atPath: path) else { return false }
        return NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    // MARK: - Health Checks

    func checkAllStatuses() async {
        isChecking = true
        defer { isChecking = false }

        await withTaskGroup(of: (String, ServiceState, String?).self) { group in
            for service in services {
                group.addTask { [self] in
                    let (state, errorDetail) = await self.checkServiceStatus(service)
                    return (service.id, state, errorDetail)
                }
            }

            for await (id, state, errorDetail) in group {
                if let index = services.firstIndex(where: { $0.id == id }) {
                    let current = services[index].status
                    if current == .starting && state == .running {
                        services[index].status = .running
                        services[index].errorDetail = nil
                    } else if current == .stopping && state == .stopped {
                        services[index].status = .stopped
                        services[index].errorDetail = nil
                    } else if current != .starting && current != .stopping {
                        services[index].status = state
                        if state == .running {
                            services[index].errorDetail = nil
                        } else if let detail = errorDetail {
                            services[index].errorDetail = detail
                        }
                    }
                }
            }
        }
    }

    private func checkServiceStatus(_ service: ServiceInfo) async -> (ServiceState, String?) {
        if let url = service.healthURL {
            do {
                let (_, response) = try await session.data(from: url)
                if let http = response as? HTTPURLResponse, (200...399).contains(http.statusCode) {
                    return (.running, nil)
                }
            } catch {
                // Health check failed, fall back to launchctl
            }
        }
        return await checkLaunchctl(label: service.launchdLabel)
    }

    private func checkLaunchctl(label: String) async -> (ServiceState, String?) {
        let (exitCode, output) = await runProcess(
            "/bin/launchctl",
            arguments: ["print", "\(guiDomain)/\(label)"]
        )
        guard exitCode == 0 else { return (.stopped, nil) }

        // Plist is loaded — but is the process actually alive?
        // Check "last exit code" and "pid" from launchctl print output.
        if let lastExit = parseExitStatus(output), lastExit != 0 {
            // Process crashed — launchd still has the plist loaded but the process is dead
            return (.stopped, "Process exited with code \(lastExit)")
        }

        // Check if there's an active PID (line like "pid = 12345")
        let hasPid = output.components(separatedBy: .newlines).contains { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            return trimmed.hasPrefix("pid = ") || trimmed.hasPrefix("pid=")
        }
        if !hasPid {
            return (.stopped, "Process not running (no PID)")
        }

        return (.running, nil)
    }

    // MARK: - Start / Stop

    func startService(id: String) async {
        guard let index = services.firstIndex(where: { $0.id == id }) else { return }
        let service = services[index]

        services[index].status = .starting
        services[index].errorDetail = nil

        let plistPath = resolvePlistPath(for: service.launchdLabel)
        let plistExists = FileManager.default.fileExists(atPath: plistPath)
        if !plistExists {
            let (ok, detail) = await ensureLaunchAgentsInstalledForMissingServices()
            if !ok || !FileManager.default.fileExists(atPath: plistPath) {
                services[index].status = .stopped
                services[index].errorDetail = detail ?? "LaunchAgent not installed"
                return
            }
        }

        let (bootstrapExit, bootstrapOutput) = await runProcess(
            "/bin/launchctl",
            arguments: ["bootstrap", guiDomain, plistPath]
        )

        if bootstrapExit != 0 {
            // Already bootstrapped or error — try kickstart
            let (kickExit, kickOutput) = await runProcess(
                "/bin/launchctl",
                arguments: ["kickstart", "-k", "\(guiDomain)/\(service.launchdLabel)"]
            )
            if kickExit != 0 {
                // Check if it's a "not loaded" scenario vs actual error
                let errMsg = kickOutput.trimmingCharacters(in: .whitespacesAndNewlines)
                if !errMsg.isEmpty && !bootstrapOutput.contains("Already loaded") {
                    services[index].errorDetail = parseError(bootstrapOutput + " " + kickOutput)
                }
            }
        }

        // Poll for the service to come up (up to 10 seconds)
        for _ in 0..<10 {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            let (state, errorDetail) = await checkServiceStatus(service)
            if state == .running {
                services[index].status = .running
                services[index].errorDetail = nil
                return
            }
            // checkServiceStatus now detects crashes via exit code + PID check
            if let detail = errorDetail {
                services[index].status = .stopped
                services[index].errorDetail = detail
                return
            }
        }

        // Timed out
        let (finalState, finalError) = await checkServiceStatus(service)
        services[index].status = finalState
        if finalState != .running {
            services[index].errorDetail = finalError ?? "Timed out waiting for service to start"
        }
    }

    func stopService(id: String) async {
        guard let index = services.firstIndex(where: { $0.id == id }) else { return }
        let service = services[index]

        services[index].status = .stopping
        services[index].errorDetail = nil

        let (exitCode, output) = await runProcess(
            "/bin/launchctl",
            arguments: ["bootout", "\(guiDomain)/\(service.launchdLabel)"]
        )

        if exitCode != 0 {
            let errMsg = output.trimmingCharacters(in: .whitespacesAndNewlines)
            if !errMsg.isEmpty {
                services[index].errorDetail = parseError(output)
            }
        }

        try? await Task.sleep(nanoseconds: 500_000_000)

        let (finalState, _) = await checkServiceStatus(service)
        services[index].status = finalState
        if finalState == .stopped {
            services[index].errorDetail = nil
        }
    }

    func startAll() async {
        let missingPlists = services.filter {
            !FileManager.default.fileExists(atPath: resolvePlistPath(for: $0.launchdLabel))
        }
        if !missingPlists.isEmpty {
            let (ok, detail) = await ensureLaunchAgentsInstalledForMissingServices()
            if !ok {
                for idx in services.indices
                where !FileManager.default.fileExists(atPath: resolvePlistPath(for: services[idx].launchdLabel)) {
                    services[idx].status = .stopped
                    services[idx].errorDetail = detail ?? "LaunchAgent not installed"
                }
            }
        }
        for service in services
        where service.status != .running
            && service.status != .starting
            && FileManager.default.fileExists(atPath: resolvePlistPath(for: service.launchdLabel))
        {
            await startService(id: service.id)
        }
    }

    func stopAll() async {
        for service in services where service.status == .running {
            await stopService(id: service.id)
        }
    }

    // MARK: - Meeting Capture

    func refreshMeetingStatus() async {
        guard !meetingIsBusy else { return }
        meetingIsBusy = true
        defer { meetingIsBusy = false }
        do {
            await refreshMeetingDevicesCatalog(requestPermissions: true)
            let text = try await invokeMeetingTool(action: "status", args: [:], timeoutSec: 20)
            applyMeetingStatus(text, forceRecording: nil)
            meetingLastResult = text
            meetingErrorMessage = nil
        } catch {
            meetingStatusMessage = "Status check failed"
            meetingErrorMessage = error.localizedDescription
        }
    }

    func startMeetingRecording() async {
        guard !meetingIsBusy else { return }
        meetingErrorMessage = nil
        guard meetingCaptureSystemAudioOnStart || meetingCaptureMicOnStart else {
            meetingStatusMessage = "Select at least one capture source"
            meetingErrorMessage = "Enable System Audio and/or Microphone before starting capture."
            return
        }
        meetingIsBusy = true
        defer { meetingIsBusy = false }
        do {
            await refreshMeetingDevicesCatalog(requestPermissions: true)
            var startArgs: [String: Any] = [
                "liveTranscript": meetingLiveTranscriptOnStart,
                "systemAudio": meetingCaptureSystemAudioOnStart,
                "mic": meetingCaptureMicOnStart,
                "requestPermissions": false,
            ]
            if let binaryPath = bundledMeetingCaptureBinaryPath {
                startArgs["binaryPath"] = binaryPath
            }
            if meetingCaptureMicOnStart,
               meetingSelectedMicDeviceId != Self.systemDefaultMicSelectionId {
                startArgs["micDeviceId"] = meetingSelectedMicDeviceId
            }
            let text = try await invokeMeetingTool(
                action: "start",
                args: startArgs,
                timeoutSec: 60)
            let lower = text.lowercased()
            let started = lower.contains("recording started")
                || lower.contains("already recording")
                || lower.contains("recording in progress")
            applyMeetingStatus(text, forceRecording: started ? true : false)
            meetingLastResult = text
            meetingErrorMessage = started ? nil : cleanStatusText(
                text.split(whereSeparator: \.isNewline).first.map(String.init) ?? "Start failed")
        } catch {
            meetingStatusMessage = "Start failed"
            meetingErrorMessage = error.localizedDescription
        }
    }

    func stopMeetingRecording() async {
        guard !meetingIsBusy else { return }
        meetingIsBusy = true
        defer { meetingIsBusy = false }
        do {
            let stopText = try await invokeMeetingTool(action: "stop", args: [:], timeoutSec: 90)
            applyMeetingStatus(stopText, forceRecording: false)
            meetingLastResult = stopText
            meetingErrorMessage = nil

            guard meetingAutoProcessOnStop else { return }
            meetingStatusMessage = "Processing transcript..."
            let meetingId: String?
            if let parsed = parseMeetingIdFromStopText(stopText) {
                meetingId = parsed
            } else {
                meetingId = try await fetchLatestMeetingId()
            }
            guard let meetingId else {
                meetingStatusMessage = "Stopped (manual process required)"
                return
            }
            let processText = try await invokeMeetingTool(
                action: "process",
                args: ["meetingId": meetingId, "createTasks": meetingCreateTasksOnProcess],
                timeoutSec: 420)
            meetingLastResult = "\(stopText)\n\n\(processText)"
            meetingStatusMessage = "Processed meeting \(meetingId)"
        } catch {
            meetingStatusMessage = "Stop/process failed"
            meetingErrorMessage = error.localizedDescription
        }
    }

    func processLatestMeeting() async {
        guard !meetingIsBusy else { return }
        meetingIsBusy = true
        defer { meetingIsBusy = false }
        do {
            guard let meetingId = try await fetchLatestMeetingId() else {
                meetingStatusMessage = "No recording available to process"
                return
            }
            meetingStatusMessage = "Processing transcript..."
            let processText = try await invokeMeetingTool(
                action: "process",
                args: ["meetingId": meetingId, "createTasks": meetingCreateTasksOnProcess],
                timeoutSec: 420)
            meetingLastResult = processText
            meetingStatusMessage = "Processed meeting \(meetingId)"
            meetingErrorMessage = nil
        } catch {
            meetingStatusMessage = "Process failed"
            meetingErrorMessage = error.localizedDescription
        }
    }

    // MARK: - Helpers

    private func invokeMeetingTool(
        action: String,
        args: [String: Any],
        timeoutSec: TimeInterval
    ) async throws -> String {
        guard let url = URL(string: "http://localhost:18789/tools/invoke") else {
            throw NSError(domain: "ArgentManager", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Invalid gateway URL",
            ])
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = timeoutSec
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = loadGatewayAuthToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let body: [String: Any] = [
            "tool": "meeting_record",
            "action": action,
            "args": args,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(domain: "ArgentManager", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Tool invoke returned non-HTTP response",
            ])
        }

        let decoded = (try? JSONDecoder().decode(MeetingToolResponse.self, from: data))
            ?? MeetingToolResponse(ok: nil, result: nil, error: nil)
        if http.statusCode < 200 || http.statusCode >= 300 || decoded.ok == false {
            let message = decoded.error?.message ?? "Meeting tool request failed (\(http.statusCode))"
            throw NSError(domain: "ArgentManager", code: http.statusCode, userInfo: [
                NSLocalizedDescriptionKey: message,
            ])
        }

        if let text = decoded.result?.content?.first(where: { $0.type == "text" })?.text?.trimmingCharacters(
            in: .whitespacesAndNewlines
        ), !text.isEmpty {
            return text
        }
        if let fallback = String(data: data, encoding: .utf8), !fallback.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return fallback
        }
        return ""
    }

    private func loadGatewayAuthToken() -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let configPath = "\(home)/.argentos/argent.json"
        guard let data = FileManager.default.contents(atPath: configPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let gateway = json["gateway"] as? [String: Any],
              let auth = gateway["auth"] as? [String: Any]
        else {
            return nil
        }
        if let token = auth["token"] as? String, !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return token
        }
        if let password = auth["password"] as? String, !password.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return password
        }
        return nil
    }

    private func refreshMeetingDevicesCatalog(requestPermissions: Bool = false) async {
        if requestPermissions {
            await requestAppMicrophoneAccessIfNeeded()
            await forceMicrophonePromptViaCaptureSessionIfNeeded()
        }
        meetingMicPermission = appMicrophonePermissionString()

        if let payload = await probeBundledCaptureDevices(requestPermissions: requestPermissions) {
            applyMeetingDevicesPayload(payload)
            return
        }

        var args: [String: Any] = [:]
        if requestPermissions {
            args["requestPermissions"] = true
        }
        if let binaryPath = bundledMeetingCaptureBinaryPath {
            args["binaryPath"] = binaryPath
        }
        guard let text = try? await invokeMeetingTool(action: "devices", args: args, timeoutSec: 20) else {
            return
        }
        guard let data = text.data(using: .utf8) else { return }
        guard let payload = try? JSONDecoder().decode(MeetingDevicesPayload.self, from: data) else {
            return
        }
        if payload.ok == false { return }
        applyMeetingDevicesPayload(payload)
    }

    private func applyMeetingDevicesPayload(_ payload: MeetingDevicesPayload) {
        let listed = (payload.micDevices ?? []).map {
            MeetingMicDevice(
                id: $0.id,
                name: $0.name,
                isDefault: $0.isDefault ?? false)
        }
        if listed.isEmpty, let defaultId = payload.defaultMicDeviceId, let defaultName = payload.defaultMicDeviceName {
            meetingMicDevices = [MeetingMicDevice(id: defaultId, name: defaultName, isDefault: true)]
        } else {
            meetingMicDevices = listed
        }
        let appPermission = appMicrophonePermissionString()
        if appPermission != "not_determined" && appPermission != "unknown" {
            meetingMicPermission = appPermission
        } else if let reportedMicPermission = payload.microphonePermission, !reportedMicPermission.isEmpty {
            meetingMicPermission = reportedMicPermission
        }
        if let screenPermission = payload.screenCapturePermission {
            meetingScreenCapturePermission = screenPermission
        }

        if meetingSelectedMicDeviceId != Self.systemDefaultMicSelectionId {
            let stillExists = meetingMicDevices.contains(where: { $0.id == meetingSelectedMicDeviceId })
            if !stillExists {
                meetingSelectedMicDeviceId = Self.systemDefaultMicSelectionId
            }
        }
    }

    private func appMicrophonePermissionString() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return "authorized"
        case .denied:
            return "denied"
        case .restricted:
            return "restricted"
        case .notDetermined:
            return "not_determined"
        @unknown default:
            return "unknown"
        }
    }

    private func requestAppMicrophoneAccessIfNeeded() async {
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined else { return }
        _ = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    private func forceMicrophonePromptViaCaptureSessionIfNeeded() async {
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined else { return }
        guard let device = AVCaptureDevice.default(for: .audio) else { return }

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                let session = AVCaptureSession()
                defer {
                    if session.isRunning {
                        session.stopRunning()
                    }
                    continuation.resume()
                }
                do {
                    let input = try AVCaptureDeviceInput(device: device)
                    guard session.canAddInput(input) else { return }
                    session.addInput(input)
                    session.startRunning()
                    Thread.sleep(forTimeInterval: 0.4)
                } catch {
                    return
                }
            }
        }
    }

    private func decodeMeetingDevicesPayload(from text: String) -> MeetingDevicesPayload? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let directData = trimmed.data(using: .utf8),
           let directPayload = try? JSONDecoder().decode(MeetingDevicesPayload.self, from: directData) {
            return directPayload
        }

        guard let start = trimmed.firstIndex(of: "{"), let end = trimmed.lastIndex(of: "}") else {
            return nil
        }
        let jsonSlice = String(trimmed[start...end])
        guard let data = jsonSlice.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(MeetingDevicesPayload.self, from: data)
    }

    private func probeBundledCaptureDevices(requestPermissions: Bool) async -> MeetingDevicesPayload? {
        guard let binaryPath = bundledMeetingCaptureBinaryPath else { return nil }
        var args = ["--output-dir", "\(NSHomeDirectory())/.argentos/meetings/audio", "--list-mic-devices"]
        if requestPermissions {
            args.append("--request-permissions")
        }
        let (code, output) = await runProcess(binaryPath, arguments: args)
        guard code == 0 else { return nil }
        guard let payload = decodeMeetingDevicesPayload(from: output) else { return nil }
        if payload.ok == false { return nil }
        return payload
    }

    private func applyMeetingStatus(_ text: String, forceRecording: Bool?) {
        if let forceRecording {
            meetingIsRecording = forceRecording
        } else {
            let lower = text.lowercased()
            meetingIsRecording = lower.contains("recording in progress") || lower.contains("already recording")
        }
        if let first = text.split(whereSeparator: \.isNewline).first {
            meetingStatusMessage = cleanStatusText(String(first))
        } else {
            meetingStatusMessage = meetingIsRecording ? "Recording in progress" : "Meeting capture idle"
        }
    }

    private func cleanStatusText(_ text: String) -> String {
        text
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "`", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func fetchLatestMeetingId() async throws -> String? {
        let listText = try await invokeMeetingTool(action: "list", args: ["limit": 1], timeoutSec: 20)
        return firstRegexCapture(listText, pattern: #"\(([A-Za-z0-9_-]+)\)\s+—"#)
    }

    private func parseMeetingIdFromStopText(_ text: String) -> String? {
        firstRegexCapture(text, pattern: #"meetingId=([A-Za-z0-9_-]+)"#)
    }

    private func firstRegexCapture(_ text: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let nsRange = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: nsRange), match.numberOfRanges > 1 else {
            return nil
        }
        let captureRange = match.range(at: 1)
        guard let range = Range(captureRange, in: text) else { return nil }
        let value = String(text[range]).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private func resolvePlistPath(for label: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/Library/LaunchAgents/\(label).plist"
    }

    private func parseError(_ output: String) -> String {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return "Unknown launchctl error"
        }
        // Extract meaningful part from launchctl errors
        if trimmed.contains("Could not find specified service") {
            return "Service not registered"
        } else if trimmed.contains("Operation not permitted") {
            return "Permission denied"
        } else if trimmed.contains("No such file or directory") {
            return "LaunchAgent plist not found"
        } else if trimmed.contains("Already loaded") {
            return nil ?? "Already loaded"
        }
        // Return last meaningful line, capped
        let lines = trimmed.components(separatedBy: .newlines).filter { !$0.isEmpty }
        let msg = lines.last ?? trimmed
        return String(msg.prefix(80))
    }

    private func parseExitStatus(_ printOutput: String) -> Int? {
        // launchctl print includes "last exit code = X"
        let lines = printOutput.components(separatedBy: .newlines)
        for line in lines {
            if line.contains("last exit code") {
                let parts = line.components(separatedBy: "=")
                if let last = parts.last?.trimmingCharacters(in: .whitespacesAndNewlines),
                   let code = Int(last) {
                    return code
                }
            }
        }
        return nil
    }

    private func ensureLaunchAgentsInstalledForMissingServices() async -> (Bool, String?) {
        let fm = FileManager.default
        let gatewayPlist = resolvePlistPath(for: "ai.argent.gateway")
        let uiPlist = resolvePlistPath(for: "ai.argent.dashboard-ui")
        let apiPlist = resolvePlistPath(for: "ai.argent.dashboard-api")

        guard fm.fileExists(atPath: nodePath), fm.fileExists(atPath: agentScript) else {
            return (false, "Runtime not found. Re-run setup.")
        }

        // Only install missing plists; do not force reinstall solely due node-path mismatch.
        // Existing user plists may intentionally point at a workspace runtime.
        let needsGatewayInstall = !fm.fileExists(atPath: gatewayPlist)
        if needsGatewayInstall {
            let (code, output) = await runProcess(
                nodePath,
                arguments: [agentScript, "gateway", "install", "--force"],
                cwd: effectiveRuntimeDir
            )
            if code != 0 {
                let detail = parseError(output)
                return (false, "LaunchAgent install failed (\(detail))")
            }
        }

        // Same rule for dashboard services: install only when missing.
        let needsDashboardInstall = !fm.fileExists(atPath: uiPlist)
            || !fm.fileExists(atPath: apiPlist)
        if needsDashboardInstall {
            let (code, output) = await runProcess(
                nodePath,
                arguments: [agentScript, "cs", "install"],
                cwd: effectiveRuntimeDir
            )
            if code != 0 {
                let detail = parseError(output)
                return (false, "Dashboard LaunchAgent install failed (\(detail))")
            }
        }

        return (true, nil)
    }

    private func launchAgentProgramPath(plistPath: String) -> String? {
        guard let data = FileManager.default.contents(atPath: plistPath) else { return nil }
        guard let object = try? PropertyListSerialization.propertyList(from: data, format: nil) else { return nil }
        guard let dict = object as? [String: Any] else { return nil }
        guard let programArgs = dict["ProgramArguments"] as? [String], !programArgs.isEmpty else { return nil }
        return programArgs[0]
    }

    private func runProcess(_ path: String, arguments: [String], cwd: String? = nil) async -> (Int32, String) {
        await withCheckedContinuation { continuation in
            let process = Process()
            let pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: path)
            process.arguments = arguments
            if let cwd {
                process.currentDirectoryURL = URL(fileURLWithPath: cwd)
            }
            process.standardOutput = pipe
            process.standardError = pipe

            do {
                try process.run()
                process.waitUntilExit()
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(data: data, encoding: .utf8) ?? ""
                continuation.resume(returning: (process.terminationStatus, output))
            } catch {
                continuation.resume(returning: (-1, error.localizedDescription))
            }
        }
    }
}
