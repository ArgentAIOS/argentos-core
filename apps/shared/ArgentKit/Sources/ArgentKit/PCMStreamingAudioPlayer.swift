@preconcurrency import AVFoundation
import Foundation
import OSLog
import ElevenLabsKit

@MainActor
protocol PCMPlayerNodeing: AnyObject {
    var isPlaying: Bool { get }
    func attach(to engine: AVAudioEngine)
    func connect(to engine: AVAudioEngine, format: AVAudioFormat)
    func scheduleBuffer(_ buffer: AVAudioPCMBuffer) async
    func play()
    func stop()
    func currentTimeSeconds() -> Double?
}

private final class PendingResumeBox {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Never>?

    init(_ continuation: CheckedContinuation<Void, Never>) {
        self.continuation = continuation
    }

    func resume() {
        let continuation: CheckedContinuation<Void, Never>?
        lock.lock()
        continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(returning: ())
    }
}

@MainActor
final class AVAudioPlayerNodeAdapter: PCMPlayerNodeing, @unchecked Sendable {
    private let node: AVAudioPlayerNode
    private let pendingLock = NSLock()
    private var pending: [UUID: PendingResumeBox] = [:]

    init(node: AVAudioPlayerNode = AVAudioPlayerNode()) {
        self.node = node
    }

    var isPlaying: Bool { node.isPlaying }

    func attach(to engine: AVAudioEngine) {
        engine.attach(node)
    }

    func connect(to engine: AVAudioEngine, format: AVAudioFormat) {
        engine.connect(node, to: engine.mainMixerNode, format: format)
    }

    func scheduleBuffer(_ buffer: AVAudioPCMBuffer) async {
        let id = UUID()
        await withCheckedContinuation { continuation in
            let box = PendingResumeBox(continuation)
            pendingLock.lock()
            pending[id] = box
            pendingLock.unlock()

            node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.resumePending(id: id)
                }
            }
        }
    }

    func play() {
        node.play()
    }

    func stop() {
        node.stop()
        let boxes: [PendingResumeBox]
        pendingLock.lock()
        boxes = Array(pending.values)
        pending.removeAll()
        pendingLock.unlock()
        for box in boxes {
            box.resume()
        }
    }

    func currentTimeSeconds() -> Double? {
        guard let nodeTime = node.lastRenderTime,
              let playerTime = node.playerTime(forNodeTime: nodeTime)
        else { return nil }
        return Double(playerTime.sampleTime) / playerTime.sampleRate
    }

    private func resumePending(id: UUID) {
        let box: PendingResumeBox?
        pendingLock.lock()
        box = pending.removeValue(forKey: id)
        pendingLock.unlock()
        box?.resume()
    }
}

/// Plays 16-bit PCM streaming audio using AVAudioEngine.
@MainActor
public final class PCMStreamingAudioPlayer {
    /// Shared PCM player instance.
    public static let shared = PCMStreamingAudioPlayer()

    private let logger = Logger(subsystem: "ai.argent.mac", category: "talk.tts.pcm")
    private let playerFactory: () -> PCMPlayerNodeing
    private let engineFactory: () -> AVAudioEngine
    private let startEngine: (AVAudioEngine) throws -> Void
    private let stopEngine: (AVAudioEngine) -> Void
    private var engine: AVAudioEngine
    private var player: PCMPlayerNodeing
    private var format: AVAudioFormat?
    private var pendingBuffers: Int = 0
    private var inputFinished = false
    private var continuation: CheckedContinuation<ElevenLabsKit.StreamingPlaybackResult, Never>?

    /// Creates a default PCM player.
    public init() {
        self.playerFactory = { AVAudioPlayerNodeAdapter() }
        self.engineFactory = { AVAudioEngine() }
        self.startEngine = { engine in try engine.start() }
        self.stopEngine = { engine in engine.stop() }
        self.engine = engineFactory()
        self.player = playerFactory()
        player.attach(to: engine)
    }

    init(
        playerFactory: @escaping () -> PCMPlayerNodeing,
        engineFactory: @escaping () -> AVAudioEngine,
        startEngine: @escaping (AVAudioEngine) throws -> Void,
        stopEngine: @escaping (AVAudioEngine) -> Void
    ) {
        self.playerFactory = playerFactory
        self.engineFactory = engineFactory
        self.startEngine = startEngine
        self.stopEngine = stopEngine
        self.engine = engineFactory()
        self.player = playerFactory()
        player.attach(to: engine)
    }

    public func play(stream: AsyncThrowingStream<Data, Error>, sampleRate: Double) async -> ElevenLabsKit.StreamingPlaybackResult {
        stopInternal()

        let format = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: true
        )

        guard let format else {
            return ElevenLabsKit.StreamingPlaybackResult(finished: false, interruptedAt: nil)
        }
        configure(format: format)

        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            self.pendingBuffers = 0
            self.inputFinished = false

            Task { @MainActor [weak self] in
                guard let self else { return }
                do {
                    for try await chunk in stream {
                        await enqueuePCM(chunk, format: format)
                    }
                    finishInput()
                } catch {
                    fail(error)
                }
            }
        }
    }

    public func stop() -> Double? {
        let interruptedAt = currentTimeSeconds()
        stopInternal()
        finish(ElevenLabsKit.StreamingPlaybackResult(finished: false, interruptedAt: interruptedAt))
        return interruptedAt
    }

    private func configure(format: AVAudioFormat) {
        if self.format?.sampleRate != format.sampleRate || self.format?.commonFormat != format.commonFormat {
            // Stop the old player first to flush all pending completion callbacks
            // before releasing references. AVAudioPlayerNode's internal
            // CompletionHandlerQueue can fire callbacks after deallocation
            // causing EXC_BAD_ACCESS in swift_continuation_resume.
            let oldPlayer = player
            let oldEngine = engine
            oldPlayer.stop()
            stopEngine(oldEngine)

            engine = engineFactory()
            player = playerFactory()
            player.attach(to: engine)

            // oldPlayer/oldEngine released here after callbacks are flushed
            _ = oldPlayer
            _ = oldEngine
        }
        self.format = format
        player.connect(to: engine, format: format)
    }

    private func enqueuePCM(_ data: Data, format: AVAudioFormat) async {
        guard !data.isEmpty else { return }
        let frameCount = data.count / MemoryLayout<Int16>.size
        guard frameCount > 0 else { return }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frameCount)) else {
            return
        }
        buffer.frameLength = AVAudioFrameCount(frameCount)

        data.withUnsafeBytes { raw in
            guard let src = raw.baseAddress else { return }
            let audioBuffer = buffer.audioBufferList.pointee.mBuffers
            if let dst = audioBuffer.mData {
                memcpy(dst, src, frameCount * MemoryLayout<Int16>.size)
            }
        }

        pendingBuffers += 1
        Task { @MainActor [weak self] in
            guard let self else { return }
            await player.scheduleBuffer(buffer)
            bufferDidFinish()
        }

        if !player.isPlaying {
            do {
                try startEngine(engine)
                player.play()
            } catch {
                logger.error("pcm engine start failed: \(error.localizedDescription, privacy: .public)")
                fail(error)
            }
        }
    }

    private func bufferDidFinish() {
        pendingBuffers = max(0, pendingBuffers - 1)
        if inputFinished, pendingBuffers == 0 {
            finish(ElevenLabsKit.StreamingPlaybackResult(finished: true, interruptedAt: nil))
        }
    }

    private func finishInput() {
        inputFinished = true
        if pendingBuffers == 0 {
            finish(ElevenLabsKit.StreamingPlaybackResult(finished: true, interruptedAt: nil))
        }
    }

    private func fail(_ error: Error) {
        logger.error("pcm stream failed: \(error.localizedDescription, privacy: .public)")
        finish(ElevenLabsKit.StreamingPlaybackResult(finished: false, interruptedAt: nil))
    }

    private func stopInternal() {
        player.stop()
        stopEngine(engine)
        pendingBuffers = 0
        inputFinished = false
    }

    private func finish(_ result: ElevenLabsKit.StreamingPlaybackResult) {
        let continuation = continuation
        self.continuation = nil
        continuation?.resume(returning: result)
    }

    private func currentTimeSeconds() -> Double? {
        player.currentTimeSeconds()
    }
}
