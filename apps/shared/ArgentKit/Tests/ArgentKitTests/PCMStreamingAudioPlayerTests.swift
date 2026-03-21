@preconcurrency import AVFoundation
@testable import ArgentKit
import Testing

private final class FakePCMPlayerNode: PCMPlayerNodeing {
    var isPlaying = false
    var currentTimeSecondsValue: Double?
    var scheduledBuffers: [AVAudioPCMBuffer] = []
    var continuations: [CheckedContinuation<Void, Never>] = []

    func attach(to _: AVAudioEngine) {}
    func connect(to _: AVAudioEngine, format _: AVAudioFormat) {}

    func scheduleBuffer(_ buffer: AVAudioPCMBuffer) async {
        scheduledBuffers.append(buffer)
        await withCheckedContinuation { cont in
            continuations.append(cont)
        }
    }

    func play() { isPlaying = true }

    func stop() {
        isPlaying = false
        let continuations = self.continuations
        self.continuations.removeAll()
        for cont in continuations {
            cont.resume(returning: ())
        }
    }

    func currentTimeSeconds() -> Double? { currentTimeSecondsValue }
}

@Suite @MainActor
struct PCMStreamingAudioPlayerTests {
    @Test
    func stopDuringPCMStreamReturnsInterruptedResult() async {
        let fakePlayer = FakePCMPlayerNode()
        fakePlayer.currentTimeSecondsValue = 1.25
        let player = PCMStreamingAudioPlayer(
            playerFactory: { fakePlayer },
            engineFactory: { AVAudioEngine() },
            startEngine: { _ in },
            stopEngine: { _ in }
        )

        var continuation: AsyncThrowingStream<Data, Error>.Continuation?
        let stream = AsyncThrowingStream<Data, Error> { cont in
            continuation = cont
            cont.yield(Data(repeating: 0, count: 44100))
        }

        let task = Task { @MainActor in
            await player.play(stream: stream, sampleRate: 44_100)
        }

        for _ in 0..<10 where fakePlayer.scheduledBuffers.isEmpty {
            await Task.yield()
        }

        let interruptedAt = player.stop()
        continuation?.finish()
        let result = await task.value

        #expect(result.finished == false)
        #expect(interruptedAt == 1.25)
    }
}
