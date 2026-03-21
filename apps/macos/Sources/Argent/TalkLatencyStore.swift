import Foundation
import Observation

struct TalkLatencySnapshot: Sendable {
    enum Kind: String, Sendable {
        case assistantReady
        case firstAudio
    }

    let kind: Kind
    let mode: String
    let capturedAt: Date
    let requestToAssistantMs: Int?
    let requestToFirstAudioMs: Int?
    let assistantToFirstAudioMs: Int?
    let ttsRequestToFirstAudioMs: Int?
}

@MainActor
@Observable
final class TalkLatencyStore {
    static let shared = TalkLatencyStore()

    private(set) var latest: TalkLatencySnapshot?

    private init() {}

    func recordAssistantReady(requestToAssistantMs: Int) {
        self.latest = TalkLatencySnapshot(
            kind: .assistantReady,
            mode: "assistant",
            capturedAt: Date(),
            requestToAssistantMs: requestToAssistantMs,
            requestToFirstAudioMs: nil,
            assistantToFirstAudioMs: nil,
            ttsRequestToFirstAudioMs: nil)
    }

    func recordFirstAudio(
        mode: String,
        requestToFirstAudioMs: Int,
        assistantToFirstAudioMs: Int,
        ttsRequestToFirstAudioMs: Int?)
    {
        self.latest = TalkLatencySnapshot(
            kind: .firstAudio,
            mode: mode,
            capturedAt: Date(),
            requestToAssistantMs: nil,
            requestToFirstAudioMs: requestToFirstAudioMs,
            assistantToFirstAudioMs: assistantToFirstAudioMs,
            ttsRequestToFirstAudioMs: ttsRequestToFirstAudioMs)
    }

    func clear() {
        self.latest = nil
    }
}
