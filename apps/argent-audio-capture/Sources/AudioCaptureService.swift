import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation
import OSLog
@preconcurrency import ScreenCaptureKit

/// Captures system audio via ScreenCaptureKit and microphone via AVAudioEngine,
/// writing each to separate files. Post-capture merge is handled by the caller (ffmpeg).
@MainActor
final class AudioCaptureService {
    enum CaptureError: LocalizedError {
        case noDisplays
        case writeFailed(String)
        case micUnavailable
        case micDeviceNotFound(String)
        case micDeviceSelectionFailed(OSStatus)

        var errorDescription: String? {
            switch self {
            case .noDisplays:
                "No displays available (needed for ScreenCaptureKit audio)"
            case let .writeFailed(msg):
                msg
            case .micUnavailable:
                "No audio input device available for microphone capture"
            case let .micDeviceNotFound(id):
                "Requested microphone device was not found: \(id)"
            case let .micDeviceSelectionFailed(status):
                "Failed to select microphone device (OSStatus \(status))"
            }
        }
    }

    private let logger = Logger(subsystem: "ai.argent", category: "audioCapture")

    private var systemStream: SCStream?
    private var systemRecorder: SystemAudioRecorder?
    private var micEngine: AVAudioEngine?
    private var micFile: AVAudioFile?
    private(set) var isRecording = false
    private var startTime: Date?

    var durationSec: Int {
        guard let startTime else { return 0 }
        return Int(Date().timeIntervalSince(startTime))
    }

    // MARK: - Start

    func start(
        systemAudioPath: String?,
        micPath: String?,
        captureSystemAudio: Bool,
        captureMic: Bool,
        micDeviceUID: String?
    ) async throws {
        guard !isRecording else { return }

        if captureSystemAudio {
            try await startSystemAudio(outputPath: systemAudioPath!)
        }

        if captureMic {
            try startMicrophone(outputPath: micPath!, micDeviceUID: micDeviceUID)
        }

        isRecording = true
        startTime = Date()
        logger.info("Audio capture started (system=\(captureSystemAudio) mic=\(captureMic))")
    }

    // MARK: - Stop

    func stop() async throws {
        guard isRecording else { return }
        isRecording = false

        // Stop system audio
        if let stream = systemStream {
            try? await stream.stopCapture()
            systemStream = nil
        }
        if let recorder = systemRecorder {
            try await recorder.finish()
            systemRecorder = nil
        }

        // Stop mic
        if let engine = micEngine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
            micEngine = nil
        }
        micFile = nil

        let duration = durationSec
        logger.info("Audio capture stopped after \(duration)s")
    }

    // MARK: - System Audio (ScreenCaptureKit)

    private func startSystemAudio(outputPath: String) async throws {
        let content = try await SCShareableContent.current
        let displays = content.displays.sorted { $0.displayID < $1.displayID }
        guard let display = displays.first else {
            throw CaptureError.noDisplays
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        // Minimal video config (required by ScreenCaptureKit, but we discard frames)
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1) // 1 fps, ignored
        config.capturesAudio = true
        config.sampleRate = 44100
        config.channelCount = 1

        let outputURL = URL(fileURLWithPath: outputPath)
        try? FileManager.default.removeItem(at: outputURL)

        let recorder = try SystemAudioRecorder(outputURL: outputURL, logger: logger)
        self.systemRecorder = recorder

        let stream = SCStream(filter: filter, configuration: config, delegate: recorder)
        try stream.addStreamOutput(recorder, type: .audio, sampleHandlerQueue: recorder.queue)
        self.systemStream = stream

        try await stream.startCapture()
        logger.info("System audio capture started → \(outputPath, privacy: .public)")
    }

    // MARK: - Microphone (AVAudioEngine)

    private func startMicrophone(outputPath: String, micDeviceUID: String?) throws {
        let engine = AVAudioEngine()
        let input = engine.inputNode

        if let requested = micDeviceUID?.trimmingCharacters(in: .whitespacesAndNewlines), !requested.isEmpty {
            try selectInputDevice(on: input, deviceUID: requested)
            logger.info("Using requested microphone device id \(requested, privacy: .public)")
        }

        let format = input.outputFormat(forBus: 0)

        guard format.channelCount > 0, format.sampleRate > 0 else {
            throw CaptureError.micUnavailable
        }

        let outputURL = URL(fileURLWithPath: outputPath)
        try? FileManager.default.removeItem(at: outputURL)

        // Keep mic file format identical to the input tap format to avoid
        // realtime conversion in the callback path (converter was causing traps).
        let file = try AVAudioFile(forWriting: outputURL, settings: format.settings)
        self.micFile = file

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            do {
                try file.write(from: buffer)
            } catch {
                self.logger.error("Mic write error: \(error.localizedDescription, privacy: .public)")
            }
        }

        engine.prepare()
        try engine.start()
        self.micEngine = engine
        logger.info("Microphone capture started → \(outputPath, privacy: .public)")
    }

    private func selectInputDevice(on inputNode: AVAudioInputNode, deviceUID: String) throws {
        guard let audioUnit = inputNode.audioUnit else {
            throw CaptureError.micUnavailable
        }
        var requested = try audioDeviceID(forUID: deviceUID)
        let dataSize = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &requested,
            dataSize
        )
        guard status == noErr else {
            throw CaptureError.micDeviceSelectionFailed(status)
        }
    }

    private func audioDeviceID(forUID uid: String) throws -> AudioDeviceID {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        var dataSize: UInt32 = 0
        var status = AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &dataSize
        )
        guard status == noErr, dataSize > 0 else {
            throw CaptureError.writeFailed("Unable to enumerate audio devices (status \(status))")
        }

        let count = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
        var deviceIDs = Array(repeating: AudioDeviceID(0), count: count)
        status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &dataSize,
            &deviceIDs
        )
        guard status == noErr else {
            throw CaptureError.writeFailed("Unable to read audio devices (status \(status))")
        }

        for deviceID in deviceIDs {
            var uidAddress = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyDeviceUID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            var uidRef: Unmanaged<CFString>?
            var uidSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
            let uidStatus = AudioObjectGetPropertyData(
                deviceID,
                &uidAddress,
                0,
                nil,
                &uidSize,
                &uidRef
            )
            if uidStatus == noErr, let uidCF = uidRef?.takeUnretainedValue(), (uidCF as String) == uid {
                return deviceID
            }
        }

        throw CaptureError.micDeviceNotFound(uid)
    }
}

// MARK: - System Audio Recorder (AVAssetWriter for AAC)

private final class SystemAudioRecorder: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let queue = DispatchQueue(label: "ai.argent.audioCapture.system")

    private let logger: Logger
    private let writer: AVAssetWriter
    private let audioInput: AVAssetWriterInput
    private var started = false
    private var didFinish = false
    private var sawAudio = false
    private var pendingError: String?

    init(outputURL: URL, logger: Logger) throws {
        self.logger = logger
        self.writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVNumberOfChannelsKey: 1,
            AVSampleRateKey: 44100,
            AVEncoderBitRateKey: 128_000,
        ]
        self.audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        self.audioInput.expectsMediaDataInRealTime = true

        guard self.writer.canAdd(self.audioInput) else {
            throw AudioCaptureService.CaptureError.writeFailed("Cannot add audio input to writer")
        }
        self.writer.add(self.audioInput)
        super.init()
    }

    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        queue.async {
            self.pendingError = String(describing: error)
            self.logger.error("System audio stream error: \(error.localizedDescription, privacy: .public)")
        }
        _ = stream
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio, CMSampleBufferDataIsReady(sampleBuffer) else { return }
        queue.async { self.handleAudio(sampleBuffer) }
        _ = stream
    }

    private func handleAudio(_ sampleBuffer: CMSampleBuffer) {
        if pendingError != nil || didFinish { return }

        if !started {
            guard writer.startWriting() else {
                pendingError = writer.error?.localizedDescription ?? "Failed to start writer"
                return
            }
            let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            writer.startSession(atSourceTime: pts)
            started = true
        }

        sawAudio = true
        if audioInput.isReadyForMoreMediaData {
            _ = audioInput.append(sampleBuffer)
        }
    }

    func finish() async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            queue.async {
                if let msg = self.pendingError {
                    cont.resume(throwing: AudioCaptureService.CaptureError.writeFailed(msg))
                    return
                }
                if !self.started || !self.sawAudio {
                    // No audio captured — clean exit, empty file is fine
                    cont.resume()
                    return
                }
                if self.didFinish {
                    cont.resume()
                    return
                }
                self.didFinish = true
                self.audioInput.markAsFinished()
                self.writer.finishWriting {
                    if let err = self.writer.error {
                        cont.resume(throwing: AudioCaptureService.CaptureError.writeFailed(err.localizedDescription))
                    } else {
                        cont.resume()
                    }
                }
            }
        }
    }
}
