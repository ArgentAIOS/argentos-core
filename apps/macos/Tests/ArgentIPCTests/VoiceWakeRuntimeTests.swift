import Foundation
import Testing
@testable import Argent

@Suite struct VoiceWakeRuntimeTests {
    @Test func trimsAfterTriggerKeepsPostSpeech() {
        let triggers = ["claude", "argent"]
        let text = "hey Claude how are you"
        #expect(VoiceWakeRuntime._testTrimmedAfterTrigger(text, triggers: triggers) == "how are you")
    }

    @Test func trimsAfterTriggerReturnsOriginalWhenNoTrigger() {
        let triggers = ["claude"]
        let text = "good morning friend"
        #expect(VoiceWakeRuntime._testTrimmedAfterTrigger(text, triggers: triggers) == text)
    }

    @Test func trimsAfterFirstMatchingTrigger() {
        let triggers = ["buddy", "claude"]
        let text = "hello buddy this is after trigger claude also here"
        #expect(VoiceWakeRuntime
            ._testTrimmedAfterTrigger(text, triggers: triggers) == "this is after trigger claude also here")
    }

    @Test func hasContentAfterTriggerFalseWhenOnlyTrigger() {
        let triggers = ["argent"]
        let text = "hey argent"
        #expect(!VoiceWakeRuntime._testHasContentAfterTrigger(text, triggers: triggers))
    }

    @Test func hasContentAfterTriggerTrueWhenSpeechContinues() {
        let triggers = ["claude"]
        let text = "claude write a note"
        #expect(VoiceWakeRuntime._testHasContentAfterTrigger(text, triggers: triggers))
    }

    @Test func textOnlyWakeMatchRequiresWholeWords() {
        let triggers = ["hey"]
        #expect(!WakeWordGate.matchesTextOnly(text: "they said hello", triggers: triggers))
        #expect(WakeWordGate.matchesTextOnly(text: "hey there", triggers: triggers))
    }

    @Test func stripWakeUsesOriginalTextRangeSafely() {
        let stripped = WakeWordGate.stripWake(text: "HEY Argent write a note", triggers: ["argent"])
        #expect(stripped == "write a note")
    }

    @Test func stripWakeDoesNotStripEmbeddedSubstrings() {
        let stripped = WakeWordGate.stripWake(text: "they said hello", triggers: ["hey"])
        #expect(stripped == "they said hello")
    }

    @Test func gateRequiresGapBetweenTriggerAndCommand() {
        let transcript = "hey argent do thing"
        let segments = makeSegments(
            transcript: transcript,
            words: [
                ("hey", 0.0, 0.1),
                ("argent", 0.2, 0.1),
                ("do", 0.35, 0.1),
                ("thing", 0.5, 0.1),
            ])
        let config = WakeWordGateConfig(triggers: ["argent"], minPostTriggerGap: 0.3)
        #expect(WakeWordGate.match(transcript: transcript, segments: segments, config: config) == nil)
    }

    @Test func gateAcceptsGapAndExtractsCommand() {
        let transcript = "hey argent do thing"
        let segments = makeSegments(
            transcript: transcript,
            words: [
                ("hey", 0.0, 0.1),
                ("argent", 0.2, 0.1),
                ("do", 0.9, 0.1),
                ("thing", 1.1, 0.1),
            ])
        let config = WakeWordGateConfig(triggers: ["argent"], minPostTriggerGap: 0.3)
        #expect(WakeWordGate.match(transcript: transcript, segments: segments, config: config)?.command == "do thing")
    }

    @Test func commandTextReturnsEmptyWhenNoPostTriggerBoundaryExists() {
        let transcript = "hey argent"
        let segments = makeSegments(
            transcript: transcript,
            words: [
                ("hey", 0.0, 0.1),
                ("argent", 0.2, 0.1),
            ])
        #expect(WakeWordGate.commandText(
            transcript: transcript,
            segments: segments,
            triggerEndTime: 1.0) == "")
    }
}

private func makeSegments(
    transcript: String,
    words: [(String, TimeInterval, TimeInterval)])
-> [WakeWordSegment] {
    var searchStart = transcript.startIndex
    var output: [WakeWordSegment] = []
    for (word, start, duration) in words {
        let range = transcript.range(of: word, range: searchStart..<transcript.endIndex)
        output.append(WakeWordSegment(text: word, start: start, duration: duration, range: range))
        if let range { searchStart = range.upperBound }
    }
    return output
}
