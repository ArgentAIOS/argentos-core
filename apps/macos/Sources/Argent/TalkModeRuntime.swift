import AVFoundation
import ArgentChatUI
import ArgentKit
import Foundation
import OSLog
import Speech

actor TalkModeRuntime {
    static let shared = TalkModeRuntime()

    private enum TalkModeError: LocalizedError {
        case dashboardSendFailed(String)

        var errorDescription: String? {
            switch self {
            case let .dashboardSendFailed(message):
                return "dashboard-send-failed: \(message)"
            }
        }
    }

    private let logger = Logger(subsystem: "ai.argent", category: "talk.runtime")
    private let ttsLogger = Logger(subsystem: "ai.argent", category: "talk.tts")
    private static let defaultModelIdFallback = "eleven_v3"
    private static let defaultJessicaVoiceId = "cgSgspJ2msm6clMCkdW9"

    private final class RMSMeter: @unchecked Sendable {
        private let lock = NSLock()
        private var latestRMS: Double = 0

        func set(_ rms: Double) {
            self.lock.lock()
            self.latestRMS = rms
            self.lock.unlock()
        }

        func get() -> Double {
            self.lock.lock()
            let value = self.latestRMS
            self.lock.unlock()
            return value
        }
    }

    private var recognizer: SFSpeechRecognizer?
    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var recognitionGeneration: Int = 0
    private var rmsTask: Task<Void, Never>?
    private let rmsMeter = RMSMeter()

    private var captureTask: Task<Void, Never>?
    private var silenceTask: Task<Void, Never>?
    private var phase: TalkModePhase = .idle
    private var isEnabled = false
    private var isPaused = false
    private var lifecycleGeneration: Int = 0

    private var lastHeard: Date?
    private var noiseFloorRMS: Double = 1e-4
    private var lastTranscript: String = ""
    private var lastSpeechEnergyAt: Date?

    private var defaultVoiceId: String?
    private var currentVoiceId: String?
    private var defaultModelId: String?
    private var currentModelId: String?
    private var voiceOverrideActive = false
    private var modelOverrideActive = false
    private var defaultOutputFormat: String?
    private var interruptOnSpeech: Bool = true
    private var lastInterruptedAtSeconds: Double?
    private var voiceAliases: [String: String] = [:]
    private var lastSpokenText: String?
    private var apiKey: String?
    private var fallbackVoiceId: String?
    private var lastPlaybackWasPCM: Bool = false
    private var lastPlaybackWasBuffered: Bool = false
    private var proxyEngine: AVAudioEngine?
    private var proxyPlayerNode: AVAudioPlayerNode?
    private var lastQuickSpokenText: String?
    private var lastQuickSpokenAt: Date?
    private var recentDashboardVoiceEvents: [String: Date] = [:]
    private var pendingDashboardResume = false

    private let silenceWindow: TimeInterval = 0.7
    private let minSpeechRMS: Double = 1e-3
    private let speechBoostFactor: Double = 6.0

    // MARK: - Lifecycle

    func setEnabled(_ enabled: Bool) async {
        guard enabled != self.isEnabled else { return }
        self.isEnabled = enabled
        self.lifecycleGeneration &+= 1
        if enabled {
            await self.start()
        } else {
            await self.stop()
        }
    }

    func setPaused(_ paused: Bool) async {
        guard paused != self.isPaused else { return }
        self.isPaused = paused
        await MainActor.run { TalkModeController.shared.updateLevel(0) }

        guard self.isEnabled else { return }

        if paused {
            self.lastTranscript = ""
            self.lastHeard = nil
            self.lastSpeechEnergyAt = nil
            await self.stopRecognition()
            return
        }

        if self.phase == .idle || self.phase == .listening {
            await self.startRecognition()
            self.phase = .listening
            await MainActor.run { TalkModeController.shared.updatePhase(.listening) }
            self.startSilenceMonitor()
        }
    }

    private func isCurrent(_ generation: Int) -> Bool {
        generation == self.lifecycleGeneration && self.isEnabled
    }

    private func isOperational(_ generation: Int, allowDisabled: Bool) -> Bool {
        generation == self.lifecycleGeneration && (allowDisabled || self.isEnabled)
    }

    private func start() async {
        let gen = self.lifecycleGeneration
        guard voiceWakeSupported else { return }
        guard PermissionManager.voiceWakePermissionsGranted() else {
            self.logger.debug("talk runtime not starting: permissions missing")
            return
        }
        await self.reloadConfig()
        guard self.isCurrent(gen) else { return }
        if self.isPaused {
            self.phase = .idle
            await MainActor.run {
                TalkModeController.shared.updateLevel(0)
                TalkModeController.shared.updatePhase(.idle)
            }
            return
        }
        await self.startRecognition()
        guard self.isCurrent(gen) else { return }
        self.phase = .listening
        await MainActor.run { TalkModeController.shared.updatePhase(.listening) }
        self.startSilenceMonitor()
    }

    private func stop() async {
        self.captureTask?.cancel()
        self.captureTask = nil
        self.silenceTask?.cancel()
        self.silenceTask = nil

        // Stop audio before changing phase (stopSpeaking is gated on .speaking).
        await self.stopSpeaking(reason: .manual)

        self.lastTranscript = ""
        self.lastHeard = nil
        self.lastSpeechEnergyAt = nil
        self.phase = .idle
        await self.stopRecognition()
        await MainActor.run {
            TalkModeController.shared.updateLevel(0)
            TalkModeController.shared.updatePhase(.idle)
        }
    }

    // MARK: - Speech recognition

    private struct RecognitionUpdate {
        let transcript: String?
        let hasConfidence: Bool
        let isFinal: Bool
        let errorDescription: String?
        let generation: Int
    }

    private func startRecognition() async {
        await self.stopRecognition()
        self.recognitionGeneration &+= 1
        let generation = self.recognitionGeneration

        let locale = await MainActor.run { AppStateStore.shared.voiceWakeLocaleID }
        self.recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale))
        guard let recognizer, recognizer.isAvailable else {
            self.logger.error("talk recognizer unavailable")
            return
        }

        self.recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        self.recognitionRequest?.shouldReportPartialResults = true
        guard let request = self.recognitionRequest else { return }

        if self.audioEngine == nil {
            self.audioEngine = AVAudioEngine()
        }
        guard let audioEngine = self.audioEngine else { return }

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        let meter = self.rmsMeter
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak request, meter] buffer, _ in
            request?.append(buffer)
            if let rms = Self.rmsLevel(buffer: buffer) {
                meter.set(rms)
            }
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            self.logger.error("talk audio engine start failed: \(error.localizedDescription, privacy: .public)")
            return
        }

        self.startRMSTicker(meter: meter)

        self.recognitionTask = recognizer.recognitionTask(with: request) { [weak self, generation] result, error in
            guard let self else { return }
            let segments = result?.bestTranscription.segments ?? []
            let transcript = result?.bestTranscription.formattedString
            let update = RecognitionUpdate(
                transcript: transcript,
                hasConfidence: segments.contains { $0.confidence > 0.6 },
                isFinal: result?.isFinal ?? false,
                errorDescription: error?.localizedDescription,
                generation: generation)
            Task { await self.handleRecognition(update) }
        }
    }

    private func stopRecognition() async {
        self.recognitionGeneration &+= 1
        self.recognitionTask?.cancel()
        self.recognitionTask = nil
        self.recognitionRequest?.endAudio()
        self.recognitionRequest = nil
        self.audioEngine?.inputNode.removeTap(onBus: 0)
        self.audioEngine?.stop()
        self.audioEngine = nil
        self.recognizer = nil
        self.rmsTask?.cancel()
        self.rmsTask = nil
    }

    private func startRMSTicker(meter: RMSMeter) {
        self.rmsTask?.cancel()
        self.rmsTask = Task { [weak self, meter] in
            while let self {
                try? await Task.sleep(nanoseconds: 50_000_000)
                if Task.isCancelled { return }
                await self.noteAudioLevel(rms: meter.get())
            }
        }
    }

    private func handleRecognition(_ update: RecognitionUpdate) async {
        guard update.generation == self.recognitionGeneration else { return }
        guard !self.isPaused else { return }
        if let errorDescription = update.errorDescription {
            self.logger.debug("talk recognition error: \(errorDescription, privacy: .public)")
        }
        guard let transcript = update.transcript else { return }

        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if self.phase == .speaking, self.interruptOnSpeech {
            if await self.shouldInterrupt(transcript: trimmed, hasConfidence: update.hasConfidence) {
                await self.stopSpeaking(reason: .speech)
                self.lastTranscript = ""
                self.lastHeard = nil
                await self.startListening()
            }
            return
        }

        guard self.phase == .listening else { return }

        if !trimmed.isEmpty {
            self.lastTranscript = trimmed
            self.lastHeard = Date()
        }

        if update.isFinal {
            self.lastTranscript = trimmed
        }
    }

    // MARK: - Silence handling

    private func startSilenceMonitor() {
        self.silenceTask?.cancel()
        self.silenceTask = Task { [weak self] in
            await self?.silenceLoop()
        }
    }

    private func silenceLoop() async {
        while self.isEnabled {
            try? await Task.sleep(nanoseconds: 200_000_000)
            await self.checkSilence()
        }
    }

    private func checkSilence() async {
        guard !self.isPaused else { return }
        guard self.phase == .listening else { return }
        let transcript = self.lastTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !transcript.isEmpty else { return }
        guard let lastHeard else { return }
        let elapsed = Date().timeIntervalSince(lastHeard)
        guard elapsed >= self.silenceWindow else { return }
        await self.finalizeTranscript(transcript)
    }

    private func startListening() async {
        self.phase = .listening
        self.lastTranscript = ""
        self.lastHeard = nil
        await MainActor.run {
            TalkModeController.shared.updatePhase(.listening)
            TalkModeController.shared.updateLevel(0)
        }
    }

    private func finalizeTranscript(_ text: String) async {
        self.lastTranscript = ""
        self.lastHeard = nil
        self.phase = .thinking
        await MainActor.run { TalkModeController.shared.updatePhase(.thinking) }
        await self.stopRecognition()
        await self.sendAndSpeak(text)
    }

    // MARK: - Gateway + TTS

    func submitPushToTalkTranscript(_ transcript: String) async {
        await self.sendAndSpeak(transcript, allowDisabled: true, resumeAfter: false)
    }

    private func sendAndSpeak(_ transcript: String, allowDisabled: Bool = false, resumeAfter: Bool = true) async {
        VoiceSessionCoordinator.debugLog("sendAndSpeak: len=\(transcript.count) allowDisabled=\(allowDisabled)")
        let gen = self.lifecycleGeneration
        await self.reloadConfig()
        guard self.isOperational(gen, allowDisabled: allowDisabled) else {
            VoiceSessionCoordinator.debugLog("sendAndSpeak: NOT operational (gen=\(gen) current=\(self.lifecycleGeneration) enabled=\(self.isEnabled))")
            return
        }
        let prompt = self.buildPrompt(transcript: transcript)
        let rawTranscript = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        let dashboardIsOpen = await MainActor.run { DashboardManager.shared.hasOpenWindow() }
        let dashboardSessionKey = await DashboardManager.shared.activeSessionKey()
        VoiceSessionCoordinator.debugLog("sendAndSpeak: dashboardIsOpen=\(dashboardIsOpen) sessionKey=\(dashboardSessionKey ?? "nil")")
        let sessionKey: String
        if dashboardIsOpen {
            guard let dashboardSessionKey, !dashboardSessionKey.isEmpty else {
                VoiceSessionCoordinator.debugLog("sendAndSpeak: ABORTED — dashboard open but no session key")
                self.logger.error("talk send aborted: dashboard is open but no visible dashboard session key was available")
                if resumeAfter {
                    await self.resumeListeningIfNeeded()
                }
                return
            }
            sessionKey = dashboardSessionKey
        } else {
            // Reuse the last known dashboard session key so voice wake messages
            // appear in the same chat the dashboard shows. Falls back to the
            // gateway's canonical agent session if no dashboard session is known.
            let lastDashboard = await MainActor.run { DashboardManager.shared.lastKnownSessionKey }
            if let lastDashboard, !lastDashboard.isEmpty {
                sessionKey = lastDashboard
            } else {
                sessionKey = await GatewayConnection.shared.mainSessionKey()
            }
        }
        VoiceSessionCoordinator.debugLog("sendAndSpeak: resolved sessionKey=\(sessionKey)")
        let runId = UUID().uuidString
        let startedAt = Date().timeIntervalSince1970
        self.logger.info(
            "talk send start runId=\(runId, privacy: .public) " +
                "session=\(sessionKey, privacy: .public) " +
                "chars=\(prompt.count, privacy: .public)")

        do {
            if dashboardIsOpen {
                VoiceSessionCoordinator.debugLog("sendAndSpeak: sending via DashboardManager session=\(sessionKey) text=\(rawTranscript.prefix(60))")
                let sendResult = await DashboardManager.shared.sendMessage(rawTranscript)
                VoiceSessionCoordinator.debugLog("sendAndSpeak: dashboard.send result ok=\(sendResult.ok) error=\(sendResult.error ?? "none")")
                guard sendResult.ok else {
                    throw TalkModeError.dashboardSendFailed(sendResult.error ?? "unknown-dashboard-send-error")
                }
                self.logger.info(
                    "talk dashboard.send ok session=\(sessionKey, privacy: .public)")
                self.pendingDashboardResume = resumeAfter
                return
            } else {
                VoiceSessionCoordinator.debugLog("sendAndSpeak: sending via chatSend session=\(sessionKey) runId=\(runId)")
                let response = try await GatewayConnection.shared.chatSend(
                    sessionKey: sessionKey,
                    message: prompt,
                    thinking: "low",
                    idempotencyKey: runId,
                    attachments: [])
                VoiceSessionCoordinator.debugLog("sendAndSpeak: chatSend ok runId=\(response.runId)")
                guard self.isOperational(gen, allowDisabled: allowDisabled) else { return }
                self.logger.info(
                    "talk chat.send ok runId=\(response.runId, privacy: .public) " +
                        "session=\(sessionKey, privacy: .public)")
            }

            guard let assistantText = await self.waitForAssistantText(
                sessionKey: sessionKey,
                since: startedAt,
                timeoutSeconds: 45)
            else {
                self.logger.warning("talk assistant text missing after timeout")
                if resumeAfter {
                    await self.startListening()
                    await self.startRecognition()
                }
                return
            }
            guard self.isOperational(gen, allowDisabled: allowDisabled) else { return }

            self.logger.info("talk assistant text len=\(assistantText.count, privacy: .public)")
            let assistantReadyAt = Date().timeIntervalSince1970
            let assistantReadyMs = Self.ms(since: startedAt, now: assistantReadyAt)
            self.ttsLogger.info("talk latency assistant_ready_ms=\(assistantReadyMs, privacy: .public)")
            await MainActor.run {
                TalkLatencyStore.shared.recordAssistantReady(requestToAssistantMs: assistantReadyMs)
            }
            let spokenText: String
            if dashboardIsOpen {
                let spokenSummary = await self.awaitDashboardSpokenSummary(
                    sessionKey: sessionKey,
                    since: startedAt,
                    timeoutSeconds: 20)
                if let spokenSummary {
                    self.ttsLogger.info(
                        "talk dashboard spokenSummary observed len=\(spokenSummary.count, privacy: .public) " +
                            "preview=\(String(spokenSummary.prefix(80)), privacy: .public)")
                } else {
                    self.ttsLogger.warning("talk dashboard spokenSummary missing after timeout; falling back to assistant text")
                }
                spokenText = spokenSummary ?? assistantText
            } else {
                let spokenSummary = await self.awaitDashboardSpokenSummary(
                    sessionKey: sessionKey,
                    since: startedAt,
                    timeoutSeconds: 3)
                if let spokenSummary {
                    self.ttsLogger.info(
                        "talk standalone spokenSummary observed len=\(spokenSummary.count, privacy: .public) " +
                            "preview=\(String(spokenSummary.prefix(80)), privacy: .public)")
                }
                spokenText = spokenSummary ?? assistantText
            }
            VoiceSessionCoordinator.debugLog("sendAndSpeak: spokenText len=\(spokenText.count) preview=\(spokenText.prefix(80))")
            self.ttsLogger.info(
                "talk final spokenText len=\(spokenText.count, privacy: .public) " +
                    "preview=\(String(spokenText.prefix(100)), privacy: .public)")
            VoiceSessionCoordinator.debugLog("sendAndSpeak: calling playAssistant")
            await self.playAssistant(
                text: spokenText,
                requestStartedAt: startedAt,
                assistantReadyAt: assistantReadyAt,
                allowDisabled: allowDisabled)
            VoiceSessionCoordinator.debugLog("sendAndSpeak: playAssistant returned")
            guard self.isOperational(gen, allowDisabled: allowDisabled) else { return }
            if resumeAfter {
                await self.resumeListeningIfNeeded()
            }
            return
        } catch {
            VoiceSessionCoordinator.debugLog("sendAndSpeak: CATCH error=\(error.localizedDescription)")
            self.logger.error("talk chat.send failed: \(error.localizedDescription, privacy: .public)")
            if resumeAfter {
                await self.resumeListeningIfNeeded()
            }
            return
        }
    }

    func handleDashboardVoiceEvent(_ event: DashboardNativeVoiceEvent) async {
        // Ensure config is loaded even when voiceWake is unsupported (reloadConfig
        // normally runs from start() which is gated on voiceWakeSupported).
        if self.apiKey == nil {
            fputs("[Argent TTS] apiKey nil — loading config before playback\n", stderr)
            await self.reloadConfig()
            fputs("[Argent TTS] config loaded: apiKey=\(self.apiKey != nil) voiceId=\(self.currentVoiceId ?? self.defaultVoiceId ?? "nil")\n", stderr)
        }

        let key = "\(event.messageId):\(event.kind):\(event.text)"
        let now = Date()
        self.recentDashboardVoiceEvents = self.recentDashboardVoiceEvents.filter {
            now.timeIntervalSince($0.value) < 30
        }
        if self.recentDashboardVoiceEvents[key] != nil {
            return
        }
        self.recentDashboardVoiceEvents[key] = now

        let trimmedText = event.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedText.isEmpty else { return }

        let textToSpeak: String
        switch event.kind {
        case "tts_now":
            self.lastQuickSpokenText = trimmedText
            self.lastQuickSpokenAt = now
            textToSpeak = trimmedText
        case "tts_final":
            let trimmedFinal = self.trimRecentQuickAck(from: trimmedText)
            textToSpeak = trimmedFinal.trimmingCharacters(in: .whitespacesAndNewlines)
            if textToSpeak.isEmpty {
                self.ttsLogger.info("talk dashboard tts_final fully overlapped by recent quick ack; skipping playback")
                if self.pendingDashboardResume {
                    self.pendingDashboardResume = false
                    await self.resumeListeningIfNeeded()
                }
                return
            }
            self.lastQuickSpokenText = nil
            self.lastQuickSpokenAt = nil
        default:
            textToSpeak = trimmedText
        }

        let startedAt = Date().timeIntervalSince1970
        let assistantReadyAt = startedAt
        await self.playAssistant(
            text: textToSpeak,
            requestStartedAt: startedAt,
            assistantReadyAt: assistantReadyAt,
            allowDisabled: true,
            dashboardMessageId: event.messageId)

        if event.kind == "tts_final", self.pendingDashboardResume {
            self.pendingDashboardResume = false
            await self.resumeListeningIfNeeded()
        }
    }

    private func resumeListeningIfNeeded() async {
        if self.isPaused {
            self.lastTranscript = ""
            self.lastHeard = nil
            self.lastSpeechEnergyAt = nil
            await MainActor.run {
                TalkModeController.shared.updateLevel(0)
            }
            return
        }
        await self.startListening()
        await self.startRecognition()
    }

    private func buildPrompt(transcript: String) -> String {
        let interrupted = self.lastInterruptedAtSeconds
        self.lastInterruptedAtSeconds = nil
        return TalkPromptBuilder.build(transcript: transcript, interruptedAtSeconds: interrupted)
    }

    private func waitForAssistantText(
        sessionKey: String,
        since: Double,
        timeoutSeconds: Int) async -> String?
    {
        VoiceSessionCoordinator.debugLog("waitForAssistantText: session=\(sessionKey) since=\(since) timeout=\(timeoutSeconds)")
        let deadline = Date().addingTimeInterval(TimeInterval(timeoutSeconds))
        var pollCount = 0
        while Date() < deadline {
            pollCount += 1
            if let dashboardText = await self.latestDashboardAssistantText(sessionKey: sessionKey, since: since) {
                VoiceSessionCoordinator.debugLog("waitForAssistantText: got dashboard text len=\(dashboardText.count) after \(pollCount) polls")
                return dashboardText
            }
            if let text = await self.latestAssistantText(sessionKey: sessionKey, since: since) {
                VoiceSessionCoordinator.debugLog("waitForAssistantText: got history text len=\(text.count) after \(pollCount) polls")
                return text
            }
            if pollCount <= 3 || pollCount % 10 == 0 {
                VoiceSessionCoordinator.debugLog("waitForAssistantText: poll #\(pollCount) — no text yet")
            }
            try? await Task.sleep(nanoseconds: 300_000_000)
        }
        VoiceSessionCoordinator.debugLog("waitForAssistantText: TIMEOUT after \(pollCount) polls")
        return nil
    }

    private func latestDashboardAssistantText(sessionKey: String, since: Double? = nil) async -> String? {
        guard await MainActor.run(body: { DashboardManager.shared.hasOpenWindow() }) else { return nil }
        let payload = await DashboardManager.shared.latestAssistantMessage(sessionKey: sessionKey, since: since)
        let text = payload?.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return text?.isEmpty == false ? text : nil
    }

    private func latestDashboardSpokenSummary(sessionKey: String, since: Double? = nil) async -> String? {
        guard await MainActor.run(body: { DashboardManager.shared.hasOpenWindow() }) else { return nil }
        let payload = await DashboardManager.shared.latestAssistantMessage(sessionKey: sessionKey, since: since)
        let text = payload?.spokenSummary?.trimmingCharacters(in: .whitespacesAndNewlines)
        return text?.isEmpty == false ? text : nil
    }

    private func awaitDashboardSpokenSummary(
        sessionKey: String,
        since: Double,
        timeoutSeconds: Int) async -> String?
    {
        guard await MainActor.run(body: { DashboardManager.shared.hasOpenWindow() }) else { return nil }
        let deadline = Date().addingTimeInterval(TimeInterval(timeoutSeconds))
        while Date() < deadline {
            if let spokenSummary = await self.latestDashboardSpokenSummary(sessionKey: sessionKey, since: since) {
                return spokenSummary
            }
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        return nil
    }

    private func latestAssistantText(sessionKey: String, since: Double? = nil) async -> String? {
        do {
            let history = try await GatewayConnection.shared.chatHistory(sessionKey: sessionKey)
            let messages = history.messages ?? []
            let decoded: [ArgentChatMessage] = messages.compactMap { item in
                guard let data = try? JSONEncoder().encode(item) else { return nil }
                return try? JSONDecoder().decode(ArgentChatMessage.self, from: data)
            }
            let lastMsg = decoded.last
            let tsStr = lastMsg?.timestamp.map { String($0) } ?? "nil"
            VoiceSessionCoordinator.debugLog("latestAssistantText: history has \(decoded.count) msgs, last role=\(lastMsg?.role ?? "nil") ts=\(tsStr) since=\(since ?? -1)")
            let assistant = decoded.last { message in
                guard message.role == "assistant" else { return false }
                guard let since else { return true }
                guard let timestamp = message.timestamp else { return false }
                return TalkHistoryTimestamp.isAfter(timestamp, sinceSeconds: since)
            }
            guard let assistant else { return nil }
            let text = assistant.content.compactMap(\.text).joined(separator: "\n")
            let trimmed = text.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        } catch {
            VoiceSessionCoordinator.debugLog("latestAssistantText: ERROR \(error.localizedDescription)")
            self.logger.error("talk history fetch failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    private func playAssistant(
        text: String,
        requestStartedAt: Double,
        assistantReadyAt: Double,
        allowDisabled: Bool = false,
        dashboardMessageId: String? = nil) async
    {
        guard let input = await self.preparePlaybackInput(
            text: text,
            requestStartedAt: requestStartedAt,
            assistantReadyAt: assistantReadyAt,
            allowDisabled: allowDisabled,
            dashboardMessageId: dashboardMessageId)
        else {
            VoiceSessionCoordinator.debugLog("playAssistant: preparePlaybackInput returned nil — skipping TTS")
            return
        }
        do {
            self.ttsLogger.info(
                "talk playAssistant start len=\(input.cleanedText.count, privacy: .public) " +
                    "markerSource=\(String(describing: input.markerSource), privacy: .public)")
            // Use dashboard HTTP proxy for lowest latency TTS. The proxy at
            // localhost:9242/api/proxy/tts/elevenlabs handles API key resolution
            // and streams MP3 audio directly from ElevenLabs. Falls back to
            // gateway tts.convert RPC if proxy is unavailable.
            let voiceId = input.voiceId ?? self.currentVoiceId ?? self.defaultVoiceId
            VoiceSessionCoordinator.debugLog("playAssistant: voiceId=\(voiceId ?? "nil") len=\(input.cleanedText.count)")
            if let voiceId, !voiceId.isEmpty {
                VoiceSessionCoordinator.debugLog("playAssistant: → HTTP proxy (fast path)")
                self.ttsLogger.info("talk playAssistant using HTTP proxy TTS")
                try await self.playViaProxy(input: input, voiceId: voiceId)
            } else {
                VoiceSessionCoordinator.debugLog("playAssistant: → GATEWAY tts.convert (slow path) — no voiceId")
                self.ttsLogger.info("talk playAssistant using gateway TTS (no voiceId)")
                try await self.playGatewayTTS(input: input)
            }
            VoiceSessionCoordinator.debugLog("playAssistant: playback finished OK")
            self.ttsLogger.info("talk playAssistant playback finished")
        } catch {
            VoiceSessionCoordinator.debugLog("playAssistant: TTS CATCH error=\(error.localizedDescription)")
            let dashboardOpen = await MainActor.run { DashboardManager.shared.hasOpenWindow() }
            if dashboardOpen {
                self.ttsLogger
                    .error(
                        "talk TTS failed: \(error.localizedDescription, privacy: .public); " +
                            "suppressing system voice fallback while dashboard-driven voice is active")
            } else {
                self.ttsLogger
                    .error(
                        "talk TTS failed: \(error.localizedDescription, privacy: .public); " +
                            "falling back to system voice")
                do {
                    try await self.playSystemVoice(input: input)
                } catch {
                    self.ttsLogger.error("talk system voice failed: \(error.localizedDescription, privacy: .public)")
                }
            }
        }

        if self.phase == .speaking {
            self.phase = .thinking
            await MainActor.run { TalkModeController.shared.updatePhase(.thinking) }
            await DashboardManager.shared.setNativeVoiceSpeaking(false)
        }
    }

    private struct TalkPlaybackInput {
        let generation: Int
        let cleanedText: String
        let markerSource: String?
        let directive: TalkDirective?
        let apiKey: String?
        let voiceId: String?
        let language: String?
        let synthTimeoutSeconds: Double
        let requestStartedAt: Double
        let assistantReadyAt: Double
        let allowDisabled: Bool
        let dashboardMessageId: String?
    }

    private func preparePlaybackInput(
        text: String,
        requestStartedAt: Double,
        assistantReadyAt: Double,
        allowDisabled: Bool = false,
        dashboardMessageId: String? = nil) async -> TalkPlaybackInput?
    {
        let gen = self.lifecycleGeneration
        let parse = TalkDirectiveParser.parse(text)
        let directive = parse.directive
        let preferred = Self.extractPreferredSpokenPayload(from: text)
        var spokenCandidate = preferred?.text ?? parse.stripped
        let markerSource = preferred?.source
        if markerSource == "TTS_NOW" {
            self.ttsLogger.info("talk skipping quick TTS_NOW playback in native voice mode")
            return nil
        }
        if markerSource == "TTS" {
            spokenCandidate = self.trimRecentQuickAck(from: spokenCandidate)
        }
        let cleaned = spokenCandidate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return nil }
        guard self.isOperational(gen, allowDisabled: allowDisabled) else { return nil }

        if !parse.unknownKeys.isEmpty {
            self.logger
                .warning(
                    "talk directive ignored keys: " +
                        "\(parse.unknownKeys.joined(separator: ","), privacy: .public)")
        }

        let requestedVoice = directive?.voiceId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedVoice = self.resolveVoiceAlias(requestedVoice)
        if let requestedVoice, !requestedVoice.isEmpty, resolvedVoice == nil {
            self.logger.warning("talk unknown voice alias \(requestedVoice, privacy: .public)")
        }
        if let voice = resolvedVoice {
            if directive?.once == true {
                self.logger.info("talk voice override (once) voiceId=\(voice, privacy: .public)")
            } else {
                self.currentVoiceId = voice
                self.voiceOverrideActive = true
                self.logger.info("talk voice override voiceId=\(voice, privacy: .public)")
            }
        }

        if let model = directive?.modelId {
            if directive?.once == true {
                self.logger.info("talk model override (once) modelId=\(model, privacy: .public)")
            } else {
                self.currentModelId = model
                self.modelOverrideActive = true
            }
        }

        let language = ElevenLabsTTSClient.validatedLanguage(directive?.language)
        self.lastSpokenText = cleaned
        if markerSource == "TTS_NOW" {
            self.lastQuickSpokenText = cleaned
            self.lastQuickSpokenAt = Date()
        } else if markerSource == "TTS" {
            self.lastQuickSpokenText = nil
            self.lastQuickSpokenAt = nil
        }

        let synthTimeoutSeconds = max(20.0, min(90.0, Double(cleaned.count) * 0.12))

        guard self.isOperational(gen, allowDisabled: allowDisabled) else { return nil }

        return TalkPlaybackInput(
            generation: gen,
            cleanedText: cleaned,
            markerSource: markerSource,
            directive: directive,
            apiKey: self.apiKey,
            voiceId: self.currentVoiceId ?? self.defaultVoiceId,
            language: language,
            synthTimeoutSeconds: synthTimeoutSeconds,
            requestStartedAt: requestStartedAt,
            assistantReadyAt: assistantReadyAt,
            allowDisabled: allowDisabled,
            dashboardMessageId: dashboardMessageId)
    }

    private func attachDashboardAudioIfNeeded(messageId: String?, response: TtsConvertResponse) async {
        guard let messageId, !messageId.isEmpty else { return }
        if let audio = response.audio, !audio.isEmpty {
            let mimeType = Self.mimeType(outputFormat: response.outputFormat, audioPath: response.audioPath)
            let dataURL = "data:\(mimeType);base64,\(audio)"
            await MainActor.run {
                Task { await DashboardManager.shared.attachTtsAudio(messageId: messageId, audioURL: dataURL) }
            }
            return
        }
        if let audioPath = response.audioPath, !audioPath.isEmpty {
            let fileURL = URL(fileURLWithPath: audioPath)
            await MainActor.run {
                Task { await DashboardManager.shared.attachTtsAudio(messageId: messageId, audioURL: fileURL.absoluteString) }
            }
        }
    }

    private static func mimeType(outputFormat: String?, audioPath: String?) -> String {
        let hint = (outputFormat ?? audioPath ?? "").lowercased()
        if hint.contains("mp3") { return "audio/mpeg" }
        if hint.contains("wav") || hint.contains("pcm") { return "audio/wav" }
        if hint.contains("ogg") { return "audio/ogg" }
        if hint.contains("opus") { return "audio/ogg; codecs=opus" }
        if hint.contains("m4a") || hint.contains("aac") { return "audio/mp4" }
        return "audio/mpeg"
    }

    private func playGatewayTTS(input: TalkPlaybackInput) async throws {
        self.ttsLogger.info("talk TTS synth timeout=\(input.synthTimeoutSeconds, privacy: .public)s")
        let ttsRequestedAt = Date().timeIntervalSince1970

        var overrideParams: [String: AnyCodable] = [:]
        var elevenlabs: [String: AnyCodable] = [:]
        if let voiceId = self.currentVoiceId ?? self.defaultVoiceId {
            elevenlabs["voiceId"] = AnyCodable(voiceId)
        }
        if let modelId = input.directive?.modelId ?? self.currentModelId ?? self.defaultModelId {
            elevenlabs["modelId"] = AnyCodable(modelId)
        }
        if !elevenlabs.isEmpty {
            overrideParams["elevenlabs"] = AnyCodable(elevenlabs)
        }

        guard self.isOperational(input.generation, allowDisabled: input.allowDisabled) else { return }
        if self.interruptOnSpeech {
            guard await self.prepareForPlayback(
                generation: input.generation,
                allowDisabled: input.allowDisabled)
            else { return }
        }

        await MainActor.run { TalkModeController.shared.updatePhase(.speaking) }
        self.phase = .speaking
        await DashboardManager.shared.setNativeVoiceSpeaking(true)
        self.lastPlaybackWasBuffered = true
        self.lastPlaybackWasPCM = false

        let response = try await GatewayConnection.shared.ttsConvert(
            text: input.cleanedText,
            params: [
                "includeAudio": AnyCodable(true),
                "overrides": AnyCodable(overrideParams),
            ],
            timeoutMs: input.synthTimeoutSeconds * 1000)
        await self.attachDashboardAudioIfNeeded(messageId: input.dashboardMessageId, response: response)

        let speakStartAt = Date().timeIntervalSince1970
        self.ttsLogger.info(
            "talk latency mode=gateway-tts request_to_speak_ms=\(Self.ms(since: input.requestStartedAt, now: speakStartAt), privacy: .public) " +
                "assistant_to_speak_ms=\(Self.ms(since: input.assistantReadyAt, now: speakStartAt), privacy: .public) " +
                "tts_request_to_speak_ms=\(Self.ms(since: ttsRequestedAt, now: speakStartAt), privacy: .public)")

        let audioData = response.audio.flatMap { Data(base64Encoded: $0) }
        if let audioData, !audioData.isEmpty {
            let result = await self.playBufferedAudio(data: audioData)
            self.ttsLogger
                .info(
                    "talk audio result finished=\(result.finished, privacy: .public) " +
                        "interruptedAt=\(String(describing: result.interruptedAt), privacy: .public)")
            if !result.finished, result.interruptedAt == nil {
                throw NSError(domain: "TalkGatewayTTS", code: 2, userInfo: [
                    NSLocalizedDescriptionKey: "gateway audio playback failed",
                ])
            }
            if !result.finished, let interruptedAt = result.interruptedAt, self.phase == .speaking, self.interruptOnSpeech {
                self.lastInterruptedAtSeconds = interruptedAt
            }
            return
        }

        if let audioPath = response.audioPath, !audioPath.isEmpty {
            let fileURL = URL(fileURLWithPath: audioPath)
            let result = await self.playBufferedAudio(fileURL: fileURL)
            self.ttsLogger
                .info(
                    "talk audio file result finished=\(result.finished, privacy: .public) " +
                        "interruptedAt=\(String(describing: result.interruptedAt), privacy: .public)")
            if !result.finished, result.interruptedAt == nil {
                throw NSError(domain: "TalkGatewayTTS", code: 2, userInfo: [
                    NSLocalizedDescriptionKey: "gateway audio playback failed",
                ])
            }
            if !result.finished, let interruptedAt = result.interruptedAt, self.phase == .speaking, self.interruptOnSpeech {
                self.lastInterruptedAtSeconds = interruptedAt
            }
            return
        }

        guard audioData != nil else {
            throw NSError(domain: "TalkGatewayTTS", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "gateway returned no playable audio",
            ])
        }
    }

    private func playElevenLabs(input: TalkPlaybackInput, apiKey: String, voiceId: String) async throws {
        let desiredOutputFormat = input.directive?.outputFormat ?? self.defaultOutputFormat ?? "pcm_44100"
        let outputFormat = ElevenLabsTTSClient.validatedOutputFormat(desiredOutputFormat)
        if outputFormat == nil, !desiredOutputFormat.isEmpty {
            self.logger
                .warning(
                    "talk output_format unsupported for local playback: " +
                        "\(desiredOutputFormat, privacy: .public)")
        }

        let modelId = input.directive?.modelId ?? self.currentModelId ?? self.defaultModelId
        func makeRequest(outputFormat: String?) -> ElevenLabsTTSRequest {
            ElevenLabsTTSRequest(
                text: input.cleanedText,
                modelId: modelId,
                outputFormat: outputFormat,
                speed: TalkTTSValidation.resolveSpeed(
                    speed: input.directive?.speed,
                    rateWPM: input.directive?.rateWPM),
                stability: TalkTTSValidation.validatedStability(
                    input.directive?.stability,
                    modelId: modelId),
                similarity: TalkTTSValidation.validatedUnit(input.directive?.similarity),
                style: TalkTTSValidation.validatedUnit(input.directive?.style),
                speakerBoost: input.directive?.speakerBoost,
                seed: TalkTTSValidation.validatedSeed(input.directive?.seed),
                normalize: ElevenLabsTTSClient.validatedNormalize(input.directive?.normalize),
                language: input.language,
                latencyTier: TalkTTSValidation.validatedLatencyTier(input.directive?.latencyTier))
        }

        let request = makeRequest(outputFormat: outputFormat)
        self.ttsLogger.info("talk TTS synth timeout=\(input.synthTimeoutSeconds, privacy: .public)s")
        let ttsRequestedAt = Date().timeIntervalSince1970
        let client = ElevenLabsTTSClient(apiKey: apiKey)
        let stream = client.streamSynthesize(voiceId: voiceId, request: request)
        guard self.isOperational(input.generation, allowDisabled: input.allowDisabled) else { return }

        if self.interruptOnSpeech {
            guard await self.prepareForPlayback(
                generation: input.generation,
                allowDisabled: input.allowDisabled)
            else { return }
        }

        await MainActor.run { TalkModeController.shared.updatePhase(.speaking) }
        self.phase = .speaking
        await DashboardManager.shared.setNativeVoiceSpeaking(true)

        let result = await self.playRemoteStream(
            client: client,
            voiceId: voiceId,
            outputFormat: outputFormat,
            makeRequest: makeRequest,
            stream: stream,
            input: input,
            ttsRequestedAt: ttsRequestedAt)
        self.ttsLogger
            .info(
                "talk audio result finished=\(result.finished, privacy: .public) " +
                    "interruptedAt=\(String(describing: result.interruptedAt), privacy: .public)")
        if !result.finished, result.interruptedAt == nil {
            throw NSError(domain: "StreamingAudioPlayer", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "audio playback failed",
            ])
        }
        if !result.finished, let interruptedAt = result.interruptedAt, self.phase == .speaking {
            if self.interruptOnSpeech {
                self.lastInterruptedAtSeconds = interruptedAt
            }
        }
    }

    /// Fast TTS path: POST to dashboard HTTP proxy, stream raw PCM from ElevenLabs,
    /// and begin playback as soon as the first audio chunk arrives (~100ms of data).
    /// No API key needed — the proxy resolves it from the gateway config/secrets.
    private func playViaProxy(input: TalkPlaybackInput, voiceId: String) async throws {
        let ttsRequestedAt = Date().timeIntervalSince1970
        let modelId = input.directive?.modelId ?? self.currentModelId ?? self.defaultModelId ?? "eleven_v3"
        let sampleRate: Double = 24000

        let proxyURL = URL(string: "http://localhost:9242/api/proxy/tts/elevenlabs")!
        var request = URLRequest(url: proxyURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = input.synthTimeoutSeconds

        let body: [String: Any] = [
            "voiceId": voiceId,
            "text": input.cleanedText,
            "model_id": modelId,
            "outputFormat": "pcm_24000",
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        guard self.isOperational(input.generation, allowDisabled: input.allowDisabled) else { return }

        if self.interruptOnSpeech {
            guard await self.prepareForPlayback(
                generation: input.generation,
                allowDisabled: input.allowDisabled)
            else { return }
        }

        fputs("[Argent TTS] proxy stream request: voice=\(voiceId) model=\(modelId) len=\(input.cleanedText.count)\n", stderr)

        // Stream the response — don't buffer the whole thing
        let (asyncBytes, response) = try await URLSession.shared.bytes(for: request)
        let httpResponse = response as? HTTPURLResponse
        let ttfbMs = Int((Date().timeIntervalSince1970 - ttsRequestedAt) * 1000)

        guard let httpResponse, httpResponse.statusCode == 200 else {
            let status = httpResponse?.statusCode ?? 0
            fputs("[Argent TTS] proxy stream failed: status=\(status) ttfb=\(ttfbMs)ms\n", stderr)
            throw NSError(domain: "ProxyTTS", code: status, userInfo: [
                NSLocalizedDescriptionKey: "HTTP proxy TTS failed (\(status))",
            ])
        }

        fputs("[Argent TTS] proxy stream connected: ttfb=\(ttfbMs)ms\n", stderr)

        // Set up AVAudioEngine for streaming PCM playback.
        // Store in actor state so stopSpeaking() can interrupt.
        let format = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: true)!

        // Tear down any previous proxy engine
        self.proxyPlayerNode?.stop()
        self.proxyEngine?.stop()

        let engine = AVAudioEngine()
        let playerNode = AVAudioPlayerNode()
        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: format)
        try engine.start()
        self.proxyEngine = engine
        self.proxyPlayerNode = playerNode

        await MainActor.run { TalkModeController.shared.updatePhase(.speaking) }
        self.phase = .speaking
        await DashboardManager.shared.setNativeVoiceSpeaking(true)
        self.lastPlaybackWasBuffered = false
        self.lastPlaybackWasPCM = true

        // Accumulate bytes and schedule PCM buffers as chunks arrive.
        // 2400 samples = 100ms at 24kHz. Start playback on first chunk.
        let samplesPerChunk = 2400
        let bytesPerChunk = samplesPerChunk * 2 // 16-bit = 2 bytes/sample
        var accumulator = Data()
        var started = false
        var totalBytes = 0

        func scheduleChunk(_ chunk: Data) {
            let frameCount = UInt32(chunk.count / 2)
            guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return }
            pcmBuffer.frameLength = frameCount
            chunk.withUnsafeBytes { raw in
                guard let src = raw.baseAddress else { return }
                memcpy(pcmBuffer.int16ChannelData![0], src, chunk.count)
            }
            playerNode.scheduleBuffer(pcmBuffer)
        }

        for try await byte in asyncBytes {
            accumulator.append(byte)
            totalBytes += 1

            if accumulator.count >= bytesPerChunk {
                scheduleChunk(accumulator)
                accumulator.removeAll(keepingCapacity: true)

                if !started {
                    playerNode.play()
                    started = true
                    let playMs = Int((Date().timeIntervalSince1970 - ttsRequestedAt) * 1000)
                    fputs("[Argent TTS] ▶ first audio at \(playMs)ms (\(totalBytes) bytes)\n", stderr)
                    self.ttsLogger.info(
                        "talk latency mode=http-proxy-stream first_audio_ms=\(playMs, privacy: .public)")
                }
            }

            // Check for cancellation every ~10KB
            if totalBytes % 10000 == 0 {
                guard self.isOperational(input.generation, allowDisabled: input.allowDisabled) else {
                    playerNode.stop()
                    engine.stop()
                    return
                }
            }
        }

        // Flush remaining samples
        if !accumulator.isEmpty {
            scheduleChunk(accumulator)
        }
        if !started, totalBytes > 0 {
            playerNode.play()
            started = true
        }

        let streamMs = Int((Date().timeIntervalSince1970 - ttsRequestedAt) * 1000)
        fputs("[Argent TTS] stream complete: \(totalBytes) bytes in \(streamMs)ms\n", stderr)

        // Wait for all scheduled buffers to finish playing
        if started {
            while playerNode.isPlaying {
                guard self.isOperational(input.generation, allowDisabled: input.allowDisabled) else {
                    playerNode.stop()
                    engine.stop()
                    return
                }
                try await Task.sleep(nanoseconds: 50_000_000) // 50ms poll
            }
            // Small grace period — playerNode.isPlaying can go false briefly between buffers
            try await Task.sleep(nanoseconds: 200_000_000)
            if playerNode.isPlaying {
                while playerNode.isPlaying {
                    try await Task.sleep(nanoseconds: 50_000_000)
                }
            }
        }

        engine.stop()
        self.proxyEngine = nil
        self.proxyPlayerNode = nil
        fputs("[Argent TTS] proxy playback complete\n", stderr)
    }

    private func playRemoteStream(
        client: ElevenLabsTTSClient,
        voiceId: String,
        outputFormat: String?,
        makeRequest: (String?) -> ElevenLabsTTSRequest,
        stream: AsyncThrowingStream<Data, Error>,
        input: TalkPlaybackInput,
        ttsRequestedAt: Double) async -> StreamingPlaybackResult
    {
        let firstChunkReporter = FirstChunkReporter()
        let onFirstChunk: @Sendable (String) async -> Void = { [weak self] mode in
            guard let self else { return }
            guard firstChunkReporter.markReported() else { return }
            await self.logFirstAudioChunkLatency(
                mode: mode,
                requestStartedAt: input.requestStartedAt,
                assistantReadyAt: input.assistantReadyAt,
                ttsRequestedAt: ttsRequestedAt)
        }

        let sampleRate = TalkTTSValidation.pcmSampleRate(from: outputFormat)
        if let sampleRate {
            self.lastPlaybackWasPCM = true
            let instrumentedPCM = self.instrumentFirstChunk(stream: stream) {
                await onFirstChunk("pcm")
            }
            let result = await self.playPCM(stream: instrumentedPCM, sampleRate: sampleRate)
            if result.finished || result.interruptedAt != nil {
                return result
            }
            let mp3Format = ElevenLabsTTSClient.validatedOutputFormat("mp3_44100")
            self.ttsLogger.warning("talk pcm playback failed; retrying mp3")
            self.lastPlaybackWasPCM = false
            let mp3Stream = client.streamSynthesize(
                voiceId: voiceId,
                request: makeRequest(mp3Format))
            let instrumentedMP3 = self.instrumentFirstChunk(stream: mp3Stream) {
                await onFirstChunk("mp3-fallback")
            }
            return await self.playMP3(stream: instrumentedMP3)
        }
        self.lastPlaybackWasPCM = false
        let instrumentedMP3 = self.instrumentFirstChunk(stream: stream) {
            await onFirstChunk("mp3")
        }
        return await self.playMP3(stream: instrumentedMP3)
    }

    private func playSystemVoice(input: TalkPlaybackInput) async throws {
        self.ttsLogger.info("talk system voice start chars=\(input.cleanedText.count, privacy: .public)")
        if self.interruptOnSpeech {
            guard await self.prepareForPlayback(
                generation: input.generation,
                allowDisabled: input.allowDisabled)
            else { return }
        }
        let speakStartAt = Date().timeIntervalSince1970
        self.ttsLogger.info(
            "talk latency mode=system request_to_speak_ms=\(Self.ms(since: input.requestStartedAt, now: speakStartAt), privacy: .public) " +
                "assistant_to_speak_ms=\(Self.ms(since: input.assistantReadyAt, now: speakStartAt), privacy: .public)")
        await MainActor.run { TalkModeController.shared.updatePhase(.speaking) }
        self.phase = .speaking
        await DashboardManager.shared.setNativeVoiceSpeaking(true)
        await TalkSystemSpeechSynthesizer.shared.stop()
        try await TalkSystemSpeechSynthesizer.shared.speak(
            text: input.cleanedText,
            language: input.language)
        self.ttsLogger.info("talk system voice done")
    }

    private func prepareForPlayback(generation: Int, allowDisabled: Bool = false) async -> Bool {
        await self.startRecognition()
        return self.isOperational(generation, allowDisabled: allowDisabled)
    }

    private func resolveVoiceId(preferred: String?, apiKey: String) async -> String? {
        let trimmed = preferred?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty {
            if let resolved = self.resolveVoiceAlias(trimmed) { return resolved }
            self.ttsLogger.warning("talk unknown voice alias \(trimmed, privacy: .public)")
        }
        if let fallbackVoiceId { return fallbackVoiceId }

        do {
            let voices = try await ElevenLabsTTSClient(apiKey: apiKey).listVoices()
            guard let first = voices.first else {
                self.ttsLogger.error("elevenlabs voices list empty")
                return nil
            }
            self.fallbackVoiceId = first.voiceId
            if self.defaultVoiceId == nil {
                self.defaultVoiceId = first.voiceId
            }
            if !self.voiceOverrideActive {
                self.currentVoiceId = first.voiceId
            }
            let name = first.name ?? "unknown"
            self.ttsLogger
                .info("talk default voice selected \(name, privacy: .public) (\(first.voiceId, privacy: .public))")
            return first.voiceId
        } catch {
            self.ttsLogger.error("elevenlabs list voices failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    private func resolveVoiceAlias(_ value: String?) -> String? {
        let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let normalized = trimmed.lowercased()
        if let mapped = self.voiceAliases[normalized] { return mapped }
        if self.voiceAliases.values.contains(where: { $0.caseInsensitiveCompare(trimmed) == .orderedSame }) {
            return trimmed
        }
        return Self.isLikelyVoiceId(trimmed) ? trimmed : nil
    }

    private static func isLikelyVoiceId(_ value: String) -> Bool {
        guard value.count >= 10 else { return false }
        return value.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
    }

    private func instrumentFirstChunk(
        stream: AsyncThrowingStream<Data, Error>,
        onFirstChunk: @escaping @Sendable () async -> Void) -> AsyncThrowingStream<Data, Error>
    {
        AsyncThrowingStream { continuation in
            let task = Task {
                var emittedFirstChunk = false
                do {
                    for try await chunk in stream {
                        if !emittedFirstChunk {
                            emittedFirstChunk = true
                            await onFirstChunk()
                        }
                        continuation.yield(chunk)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func logFirstAudioChunkLatency(
        mode: String,
        requestStartedAt: Double,
        assistantReadyAt: Double,
        ttsRequestedAt: Double) async
    {
        let now = Date().timeIntervalSince1970
        let requestToFirstMs = Self.ms(since: requestStartedAt, now: now)
        let assistantToFirstMs = Self.ms(since: assistantReadyAt, now: now)
        let ttsToFirstMs = Self.ms(since: ttsRequestedAt, now: now)
        self.ttsLogger.info(
            "talk latency mode=\(mode, privacy: .public) " +
                "request_to_first_chunk_ms=\(requestToFirstMs, privacy: .public) " +
                "assistant_to_first_chunk_ms=\(assistantToFirstMs, privacy: .public) " +
                "tts_request_to_first_chunk_ms=\(ttsToFirstMs, privacy: .public)")
        await MainActor.run {
            TalkLatencyStore.shared.recordFirstAudio(
                mode: mode,
                requestToFirstAudioMs: requestToFirstMs,
                assistantToFirstAudioMs: assistantToFirstMs,
                ttsRequestToFirstAudioMs: ttsToFirstMs)
        }
    }

    private static func ms(since start: Double, now: Double) -> Int {
        Int(max(0, (now - start) * 1000).rounded())
    }

    func stopSpeaking(reason: TalkStopReason) async {
        // Stop proxy streaming engine (used by playViaProxy fast path)
        self.proxyPlayerNode?.stop()
        self.proxyEngine?.stop()
        self.proxyPlayerNode = nil
        self.proxyEngine = nil

        let interruptedAt: Double?
        if self.lastPlaybackWasBuffered {
            interruptedAt = await self.stopBufferedAudio()
            _ = await self.stopMP3()
            _ = await self.stopPCM()
            self.lastPlaybackWasBuffered = false
        } else {
            let usePCM = self.lastPlaybackWasPCM
            interruptedAt = usePCM ? await self.stopPCM() : await self.stopMP3()
            _ = usePCM ? await self.stopMP3() : await self.stopPCM()
        }
        await TalkSystemSpeechSynthesizer.shared.stop()
        await DashboardManager.shared.setNativeVoiceSpeaking(false)
        guard self.phase == .speaking else { return }
        if reason == .speech, let interruptedAt {
            self.lastInterruptedAtSeconds = interruptedAt
        }
        if reason == .manual {
            self.phase = .thinking
            await MainActor.run { TalkModeController.shared.updatePhase(.thinking) }
            return
        }
        if reason == .speech || reason == .userTap {
            await self.startListening()
            return
        }
        self.phase = .thinking
        await MainActor.run { TalkModeController.shared.updatePhase(.thinking) }
    }
}

private final class FirstChunkReporter: @unchecked Sendable {
    private let lock = NSLock()
    private var reported = false

    func markReported() -> Bool {
        self.lock.lock()
        defer { self.lock.unlock() }
        if self.reported { return false }
        self.reported = true
        return true
    }
}

extension TalkModeRuntime {
    // MARK: - Audio playback (MainActor helpers)

    @MainActor
    private func playPCM(
        stream: AsyncThrowingStream<Data, Error>,
        sampleRate: Double) async -> StreamingPlaybackResult
    {
        await PCMStreamingAudioPlayer.shared.play(stream: stream, sampleRate: sampleRate)
    }

    @MainActor
    private func playMP3(stream: AsyncThrowingStream<Data, Error>) async -> StreamingPlaybackResult {
        await StreamingAudioPlayer.shared.play(stream: stream)
    }

    @MainActor
    private func stopPCM() -> Double? {
        PCMStreamingAudioPlayer.shared.stop()
    }

    @MainActor
    private func stopMP3() -> Double? {
        StreamingAudioPlayer.shared.stop()
    }

    @MainActor
    private func playBufferedAudio(data: Data) async -> TalkPlaybackResult {
        await TalkAudioPlayer.shared.play(data: data)
    }

    @MainActor
    private func playBufferedAudio(fileURL: URL) async -> TalkPlaybackResult {
        await TalkAudioPlayer.shared.play(fileURL: fileURL)
    }

    @MainActor
    private func stopBufferedAudio() -> Double? {
        TalkAudioPlayer.shared.stop()
    }

    // MARK: - Config

    private func reloadConfig() async {
        let cfg = await self.fetchTalkConfig()
        self.defaultVoiceId = cfg.voiceId
        self.voiceAliases = cfg.voiceAliases
        if !self.voiceOverrideActive {
            self.currentVoiceId = cfg.voiceId
        }
        self.defaultModelId = cfg.modelId
        if !self.modelOverrideActive {
            self.currentModelId = cfg.modelId
        }
        self.defaultOutputFormat = cfg.outputFormat
        self.interruptOnSpeech = cfg.interruptOnSpeech
        self.apiKey = cfg.apiKey
        let hasApiKey = (cfg.apiKey?.isEmpty == false)
        let voiceLabel = (cfg.voiceId?.isEmpty == false) ? cfg.voiceId! : "none"
        let modelLabel = (cfg.modelId?.isEmpty == false) ? cfg.modelId! : "none"
        self.logger
            .info(
                "talk config voiceId=\(voiceLabel, privacy: .public) " +
                    "modelId=\(modelLabel, privacy: .public) " +
                    "apiKey=\(hasApiKey, privacy: .public) " +
                    "interrupt=\(cfg.interruptOnSpeech, privacy: .public)")
    }

    private struct TalkRuntimeConfig {
        let voiceId: String?
        let voiceAliases: [String: String]
        let modelId: String?
        let outputFormat: String?
        let interruptOnSpeech: Bool
        let apiKey: String?
    }

    private func fetchTalkConfig() async -> TalkRuntimeConfig {
        let env = ProcessInfo.processInfo.environment
        let envVoice = env["ELEVENLABS_VOICE_ID"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let sagVoice = env["SAG_VOICE_ID"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let envApiKey = env["ELEVENLABS_API_KEY"]?.trimmingCharacters(in: .whitespacesAndNewlines)

        do {
            let snap: ConfigSnapshot = try await GatewayConnection.shared.requestDecoded(
                method: .configGet,
                params: nil,
                timeoutMs: 8000)
            let talk = snap.config?["talk"]?.dictionaryValue
            let tts = snap.config?["tts"]?.dictionaryValue
            let elevenlabs = tts?["elevenlabs"]?.dictionaryValue
            let ui = snap.config?["ui"]?.dictionaryValue
            let rawSeam = ui?["seamColor"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            await MainActor.run {
                AppStateStore.shared.seamColorHex = rawSeam.isEmpty ? nil : rawSeam
            }
            let voice = talk?["voiceId"]?.stringValue
            let ttsVoice = elevenlabs?["voiceId"]?.stringValue
            let rawAliases = talk?["voiceAliases"]?.dictionaryValue
            let resolvedAliases: [String: String] =
                rawAliases?.reduce(into: [:]) { acc, entry in
                    let key = entry.key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                    let value = entry.value.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    guard !key.isEmpty, !value.isEmpty else { return }
                    acc[key] = value
                } ?? [:]
            let model = talk?["modelId"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
            let resolvedModel = (model?.isEmpty == false) ? model! : Self.defaultModelIdFallback
            let outputFormat = talk?["outputFormat"]?.stringValue
            let interrupt = talk?["interruptOnSpeech"]?.boolValue
            let apiKey = talk?["apiKey"]?.stringValue
            let resolvedVoice =
                (voice?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? voice : nil) ??
                (ttsVoice?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? ttsVoice : nil) ??
                (envVoice?.isEmpty == false ? envVoice : nil) ??
                (sagVoice?.isEmpty == false ? sagVoice : nil) ??
                Self.defaultJessicaVoiceId
            let resolvedApiKey =
                (envApiKey?.isEmpty == false ? envApiKey : nil) ??
                (apiKey?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? apiKey : nil)
            return TalkRuntimeConfig(
                voiceId: resolvedVoice,
                voiceAliases: resolvedAliases,
                modelId: resolvedModel,
                outputFormat: outputFormat,
                interruptOnSpeech: interrupt ?? true,
                apiKey: resolvedApiKey)
        } catch {
            let resolvedVoice =
                (envVoice?.isEmpty == false ? envVoice : nil) ??
                (sagVoice?.isEmpty == false ? sagVoice : nil) ??
                Self.defaultJessicaVoiceId
            let resolvedApiKey = envApiKey?.isEmpty == false ? envApiKey : nil
            return TalkRuntimeConfig(
                voiceId: resolvedVoice,
                voiceAliases: [:],
                modelId: Self.defaultModelIdFallback,
                outputFormat: nil,
                interruptOnSpeech: true,
                apiKey: resolvedApiKey)
        }
    }

    // MARK: - Audio level handling

    private func noteAudioLevel(rms: Double) async {
        if self.phase != .listening, self.phase != .speaking { return }
        let alpha: Double = rms < self.noiseFloorRMS ? 0.08 : 0.01
        self.noiseFloorRMS = max(1e-7, self.noiseFloorRMS + (rms - self.noiseFloorRMS) * alpha)

        let threshold = max(self.minSpeechRMS, self.noiseFloorRMS * self.speechBoostFactor)
        if rms >= threshold {
            let now = Date()
            self.lastHeard = now
            self.lastSpeechEnergyAt = now
        }

        if self.phase == .listening {
            let clamped = min(1.0, max(0.0, rms / max(self.minSpeechRMS, threshold)))
            await MainActor.run { TalkModeController.shared.updateLevel(clamped) }
        }
    }

    private static func rmsLevel(buffer: AVAudioPCMBuffer) -> Double? {
        guard let channelData = buffer.floatChannelData?.pointee else { return nil }
        let frameCount = Int(buffer.frameLength)
        guard frameCount > 0 else { return nil }
        var sum: Double = 0
        for i in 0..<frameCount {
            let sample = Double(channelData[i])
            sum += sample * sample
        }
        return sqrt(sum / Double(frameCount))
    }

    private func shouldInterrupt(transcript: String, hasConfidence: Bool) async -> Bool {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 3 else { return false }
        if self.isLikelyEcho(of: trimmed) { return false }
        let now = Date()
        if let lastSpeechEnergyAt, now.timeIntervalSince(lastSpeechEnergyAt) > 0.35 {
            return false
        }
        return hasConfidence
    }

    private func isLikelyEcho(of transcript: String) -> Bool {
        guard let spoken = self.lastSpokenText?.lowercased(), !spoken.isEmpty else { return false }
        let probe = transcript.lowercased()
        if probe.count < 6 {
            return spoken.contains(probe)
        }
        return spoken.contains(probe)
    }

    private func trimRecentQuickAck(from text: String) -> String {
        guard let quick = self.lastQuickSpokenText?.trimmingCharacters(in: .whitespacesAndNewlines),
              !quick.isEmpty,
              let at = self.lastQuickSpokenAt,
              Date().timeIntervalSince(at) <= 20
        else {
            return text
        }

        let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedQuick = Self.normalizedSpeechComparison(quick)
        let normalizedText = Self.normalizedSpeechComparison(trimmedText)
        guard !normalizedQuick.isEmpty, !normalizedText.isEmpty else { return text }

        if normalizedText == normalizedQuick {
            return ""
        }

        if normalizedText.hasPrefix(normalizedQuick) {
            if let range = Self.findPrefixRange(in: trimmedText, matching: quick) {
                let remainder = trimmedText[range.upperBound...]
                    .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters))
                return remainder.isEmpty ? "" : remainder
            }
        }

        if let sentenceEnd = Self.firstSentenceBoundary(in: quick) {
            let firstSentence = String(quick[..<sentenceEnd]).trimmingCharacters(in: .whitespacesAndNewlines)
            let normalizedSentence = Self.normalizedSpeechComparison(firstSentence)
            if !normalizedSentence.isEmpty,
               normalizedText.hasPrefix(normalizedSentence),
               let range = Self.findPrefixRange(in: trimmedText, matching: firstSentence)
            {
                let remainder = trimmedText[range.upperBound...]
                    .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters))
                return remainder.isEmpty ? "" : remainder
            }
        }

        return text
    }

    private static func resolveSpeed(speed: Double?, rateWPM: Int?, logger: Logger) -> Double? {
        if let rateWPM, rateWPM > 0 {
            let resolved = Double(rateWPM) / 175.0
            if resolved <= 0.5 || resolved >= 2.0 {
                logger.warning("talk rateWPM out of range: \(rateWPM, privacy: .public)")
                return nil
            }
            return resolved
        }
        if let speed {
            if speed <= 0.5 || speed >= 2.0 {
                logger.warning("talk speed out of range: \(speed, privacy: .public)")
                return nil
            }
            return speed
        }
        return nil
    }

    private static func validatedUnit(_ value: Double?, name: String, logger: Logger) -> Double? {
        guard let value else { return nil }
        if value < 0 || value > 1 {
            logger.warning("talk \(name, privacy: .public) out of range: \(value, privacy: .public)")
            return nil
        }
        return value
    }

    private static func validatedSeed(_ value: Int?, logger: Logger) -> UInt32? {
        guard let value else { return nil }
        if value < 0 || value > 4_294_967_295 {
            logger.warning("talk seed out of range: \(value, privacy: .public)")
            return nil
        }
        return UInt32(value)
    }

    private static func validatedNormalize(_ value: String?, logger: Logger) -> String? {
        guard let value else { return nil }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard ["auto", "on", "off"].contains(normalized) else {
            logger.warning("talk normalize invalid: \(normalized, privacy: .public)")
            return nil
        }
        return normalized
    }

    private static func extractPreferredSpokenPayload(from text: String) -> (source: String, text: String)? {
        if let spoken = self.extractLastMarker(named: "TTS", from: text) {
            return ("TTS", self.sanitizeSpokenMarker(spoken))
        }
        if let spokenNow = self.extractLastMarker(named: "TTS_NOW", from: text) {
            return ("TTS_NOW", self.sanitizeSpokenMarker(spokenNow))
        }
        return nil
    }

    private static func extractLastMarker(named name: String, from text: String) -> String? {
        let needle = "[\(name):"
        guard let start = text.range(of: needle, options: [.backwards]) else { return nil }
        var depth = 1
        var index = start.upperBound
        while index < text.endIndex {
            let char = text[index]
            if char == "[" {
                depth += 1
            } else if char == "]" {
                depth -= 1
                if depth == 0 {
                    return String(text[start.upperBound..<index])
                }
            }
            index = text.index(after: index)
        }
        return nil
    }

    private static func sanitizeSpokenMarker(_ text: String) -> String {
        var spoken = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if spoken.hasPrefix("["),
           let closing = spoken.firstIndex(of: "]")
        {
            let prefix = spoken[spoken.startIndex...closing]
            if !prefix.contains("\n") {
                spoken.removeSubrange(spoken.startIndex...closing)
                spoken = spoken.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return spoken
    }

    private static func normalizedSpeechComparison(_ text: String) -> String {
        text
            .lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    private static func firstSentenceBoundary(in text: String) -> String.Index? {
        text.firstIndex { [".", "!", "?"].contains($0) }
    }

    private static func findPrefixRange(in text: String, matching prefix: String) -> Range<String.Index>? {
        let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPrefix = prefix.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedText.isEmpty, !trimmedPrefix.isEmpty else { return nil }

        if trimmedText.hasPrefix(trimmedPrefix) {
            return trimmedText.startIndex..<trimmedText.index(trimmedText.startIndex, offsetBy: trimmedPrefix.count)
        }

        return nil
    }
}
