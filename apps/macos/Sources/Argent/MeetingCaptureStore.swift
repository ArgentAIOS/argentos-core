import Foundation
import Observation
import OSLog

@MainActor
@Observable
final class MeetingCaptureStore {
    static let shared = MeetingCaptureStore()

    private static let autoProcessDefaultsKey = "meeting.capture.autoProcessOnStop"
    private static let autoCreateTasksDefaultsKey = "meeting.capture.autoCreateTasksOnProcess"
    private static let autoLiveTranscriptDefaultsKey = "meeting.capture.autoLiveTranscriptOnStart"

    var isRecording = false
    var isBusy = false
    var statusMessage = "Meeting capture idle"
    var lastResult: String?
    var errorMessage: String?
    var autoProcessOnStop: Bool {
        didSet {
            UserDefaults.standard.set(self.autoProcessOnStop, forKey: Self.autoProcessDefaultsKey)
        }
    }
    var autoCreateTasksOnProcess: Bool {
        didSet {
            UserDefaults.standard.set(self.autoCreateTasksOnProcess, forKey: Self.autoCreateTasksDefaultsKey)
        }
    }
    var autoLiveTranscriptOnStart: Bool {
        didSet {
            UserDefaults.standard.set(self.autoLiveTranscriptOnStart, forKey: Self.autoLiveTranscriptDefaultsKey)
        }
    }

    private let logger = Logger(subsystem: "ai.argent", category: "meeting-capture")
    private var captureTask: Process?

    private init() {
        self.autoProcessOnStop = UserDefaults.standard.object(forKey: Self.autoProcessDefaultsKey) as? Bool ?? true
        self.autoCreateTasksOnProcess = UserDefaults.standard.object(forKey: Self.autoCreateTasksDefaultsKey) as? Bool ?? false
        self.autoLiveTranscriptOnStart = UserDefaults.standard.object(forKey: Self.autoLiveTranscriptDefaultsKey) as? Bool ?? true
    }

    func refreshStatus() async {
        guard !self.isBusy else { return }
        self.isBusy = true
        defer { self.isBusy = false }

        do {
            let text = try await GatewayConnection.shared.meetingRecorderStatus()
            self.applyStatusText(text, forceRecording: nil)
            self.lastResult = text
            self.errorMessage = nil
        } catch {
            let message = error.localizedDescription
            self.errorMessage = message
            self.statusMessage = "Status check failed"
            self.logger.error("meeting status failed: \(message, privacy: .public)")
        }
    }

    func startRecording(title: String? = nil) async {
        guard !self.isBusy else { return }
        self.isBusy = true
        defer { self.isBusy = false }

        let permissions = await PermissionManager.ensure([.microphone, .screenRecording], interactive: true)
        guard permissions[.microphone] == true || permissions[.screenRecording] == true else {
            self.errorMessage = "Recording requires Microphone or Screen Recording permissions."
            self.statusMessage = "Permission denied"
            self.logger.error("meeting start failed: missing TCC permissions")
            return
        }

        do {
            var text = try await GatewayConnection.shared.meetingRecorderStart(
                title: title,
                liveTranscript: self.autoLiveTranscriptOnStart)
                
            var executionFailed = false
            if text.hasPrefix("EXEC_PAYLOAD:") {
                let jsonString = String(text.dropFirst("EXEC_PAYLOAD:".count))
                if let data = jsonString.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let binaryName = json["binaryPath"] as? String,
                   let args = json["args"] as? [String] {
                    
                    text = (json["message"] as? String) ?? "Recording started natively"
                    
                    // Native launch! Finds the binary embedded inside the .app bundle
                    if let binaryURL = Bundle.main.url(forAuxiliaryExecutable: binaryName) {
                        let task = Process()
                        task.executableURL = binaryURL
                        task.arguments = args
                        self.captureTask = task
                        do {
                            try task.run()
                            self.logger.info("Natively launched embedded capture binary: \(binaryURL.path)")
                        } catch {
                            executionFailed = true
                            text = "Failed to launch native capture process: \(error.localizedDescription)"
                            self.logger.error("Native launch failed: \(error.localizedDescription)")
                        }
                    } else {
                        executionFailed = true
                        text = "Embedded capture binary (\(binaryName)) not found in App bundle."
                        self.logger.error("Native launch failed: App bundle missing binary")
                    }
                } else {
                    executionFailed = true
                    text = "Failed to parse EXEC_PAYLOAD"
                }
            }

            let failed = executionFailed || text.lowercased().contains("failed") || text.lowercased().contains("error")
            self.applyStatusText(text, forceRecording: !failed)
            self.lastResult = text
            if failed {
                self.errorMessage = text.components(separatedBy: .newlines).first ?? "Recording failed"
                self.statusMessage = "Start failed"
            } else {
                self.errorMessage = nil
                MeetingRecordingOverlayController.shared.present()
            }
        } catch {
            let message = error.localizedDescription
            self.errorMessage = message
            self.statusMessage = "Start failed"
            self.logger.error("meeting start failed: \(message, privacy: .public)")
        }
    }

    func stopRecording() async {
        guard !self.isBusy else { return }
        self.isBusy = true
        defer { self.isBusy = false }

        do {
            let stopText = try await GatewayConnection.shared.meetingRecorderStop()
            self.applyStatusText(stopText, forceRecording: false)
            self.lastResult = stopText
            self.errorMessage = nil
            MeetingRecordingOverlayController.shared.dismiss()

            guard self.autoProcessOnStop else { return }
            self.statusMessage = "Processing transcript…"

            let meetingId: String?
            if let parsedId = Self.parseMeetingId(fromStopText: stopText) {
                meetingId = parsedId
            } else {
                meetingId = try await self.fetchLatestMeetingId()
            }
            guard let meetingId else {
                self.statusMessage = "Stopped (manual process required)"
                return
            }

            let processText = try await GatewayConnection.shared.meetingRecorderProcess(
                meetingId: meetingId,
                createTasks: self.autoCreateTasksOnProcess)
            self.lastResult = "\(stopText)\n\n\(processText)"
            self.statusMessage = "Processed meeting \(meetingId)"
            self.errorMessage = nil
        } catch {
            let message = error.localizedDescription
            self.errorMessage = message
            self.statusMessage = "Stop/process failed"
            self.logger.error("meeting stop/process failed: \(message, privacy: .public)")
        }
    }

    func processLatest() async {
        guard !self.isBusy else { return }
        self.isBusy = true
        defer { self.isBusy = false }

        do {
            guard let meetingId = try await self.fetchLatestMeetingId() else {
                self.statusMessage = "No recording available to process"
                return
            }
            self.statusMessage = "Processing transcript…"
            let processText = try await GatewayConnection.shared.meetingRecorderProcess(
                meetingId: meetingId,
                createTasks: self.autoCreateTasksOnProcess)
            self.lastResult = processText
            self.statusMessage = "Processed meeting \(meetingId)"
            self.errorMessage = nil
        } catch {
            let message = error.localizedDescription
            self.errorMessage = message
            self.statusMessage = "Process failed"
            self.logger.error("meeting process failed: \(message, privacy: .public)")
        }
    }

    private func fetchLatestMeetingId() async throws -> String? {
        let listText = try await GatewayConnection.shared.meetingRecorderList(limit: 1)
        return Self.parseMeetingIdFromListText(listText)
    }

    private func applyStatusText(_ text: String, forceRecording: Bool?) {
        let wasRecording = self.isRecording
        if let forceRecording {
            self.isRecording = forceRecording
        } else {
            let lower = text.lowercased()
            self.isRecording = lower.contains("recording in progress") || lower.contains("already recording")
        }
        // Show/hide overlay when recording state changes via status refresh
        if self.isRecording, !wasRecording {
            MeetingRecordingOverlayController.shared.present()
        } else if !self.isRecording, wasRecording {
            MeetingRecordingOverlayController.shared.dismiss()
        }
        if let firstLine = text.split(whereSeparator: \.isNewline).first {
            self.statusMessage = String(firstLine)
        } else {
            self.statusMessage = self.isRecording ? "Recording in progress" : "Meeting capture idle"
        }
    }

    private nonisolated static func parseMeetingId(fromStopText text: String) -> String? {
        Self.firstRegexCapture(in: text, pattern: #"meetingId=([A-Za-z0-9_-]+)"#)
    }

    private nonisolated static func parseMeetingIdFromListText(_ text: String) -> String? {
        Self.firstRegexCapture(in: text, pattern: #"\(([A-Za-z0-9_-]+)\)\s+—"#)
    }

    private nonisolated static func firstRegexCapture(in text: String, pattern: String) -> String? {
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
}
