import Foundation
import Speech

struct WakeWordSegment: Equatable, Sendable {
    let text: String
    let start: TimeInterval
    let duration: TimeInterval
    let range: Range<String.Index>?

    var end: TimeInterval {
        self.start + self.duration
    }
}

struct WakeWordGateMatch: Equatable, Sendable {
    let triggerEndTime: TimeInterval
    let postGap: TimeInterval
    let command: String
}

struct WakeWordGateConfig: Equatable, Sendable {
    let triggers: [String]
    let minPostTriggerGap: TimeInterval
    let minCommandLength: Int

    init(
        triggers: [String],
        minPostTriggerGap: TimeInterval = 0.3,
        minCommandLength: Int = 1)
    {
        self.triggers = triggers
        self.minPostTriggerGap = minPostTriggerGap
        self.minCommandLength = minCommandLength
    }
}

enum WakeWordGate {
    private struct Token {
        let normalized: String
        let start: TimeInterval
        let end: TimeInterval
        let range: Range<String.Index>?
    }

    private struct Trigger {
        let tokens: [String]
    }

    static func match(
        transcript: String,
        segments: [WakeWordSegment],
        config: WakeWordGateConfig)
    -> WakeWordGateMatch? {
        let tokens = self.normalizeSegments(segments)
        guard !tokens.isEmpty else { return nil }

        for trigger in self.normalizeTriggers(config.triggers) {
            let count = trigger.tokens.count
            guard count > 0, tokens.count > count - 1 else { continue }
            for index in 0...(tokens.count - count) {
                let matched = (0..<count).allSatisfy { offset in
                    tokens[index + offset].normalized == trigger.tokens[offset]
                }
                guard matched else { continue }

                let triggerEnd = tokens[index + count - 1].end
                let nextIndex = index + count
                guard nextIndex < tokens.count else { continue }

                let nextToken = tokens[nextIndex]
                let gap = nextToken.start - triggerEnd
                guard gap >= config.minPostTriggerGap else { continue }

                let command = self.commandText(
                    transcript: transcript,
                    segments: segments,
                    triggerEndTime: triggerEnd)
                guard command.count >= config.minCommandLength else { continue }

                return WakeWordGateMatch(
                    triggerEndTime: triggerEnd,
                    postGap: gap,
                    command: command)
            }
        }

        return nil
    }

    static func matchesTextOnly(text: String, triggers: [String]) -> Bool {
        let normalizedText = self.normalizeFreeText(text)
        guard !normalizedText.isEmpty else { return false }
        return self.normalizeTriggers(triggers).contains { trigger in
            !trigger.tokens.isEmpty && normalizedText.contains(trigger.tokens.joined(separator: " "))
        }
    }

    static func stripWake(text: String, triggers: [String]) -> String {
        let lowercased = text.lowercased()
        for trigger in triggers {
            let trimmedTrigger = trigger.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedTrigger.isEmpty else { continue }
            let lowerTrigger = trimmedTrigger.lowercased()
            guard let range = lowercased.range(of: lowerTrigger) else { continue }
            let after = text[range.upperBound...]
            return after.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func commandText(
        transcript: String,
        segments: [WakeWordSegment],
        triggerEndTime: TimeInterval)
    -> String {
        let ordered = segments.sorted { lhs, rhs in
            if lhs.start == rhs.start {
                return lhs.duration < rhs.duration
            }
            return lhs.start < rhs.start
        }

        if let commandStart = ordered.first(where: { $0.start >= triggerEndTime })?.range?.lowerBound {
            return transcript[commandStart...].trimmingCharacters(in: .whitespacesAndNewlines)
        }

        if let boundary = ordered.first(where: { $0.end >= triggerEndTime })?.range?.upperBound {
            return transcript[boundary...].trimmingCharacters(in: .whitespacesAndNewlines)
        }

        return transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func normalizeTriggers(_ triggers: [String]) -> [Trigger] {
        triggers.compactMap { trigger in
            let tokens = trigger
                .split(whereSeparator: { $0.isWhitespace })
                .map { VoiceWakeTextUtils.normalizeToken(String($0)) }
                .filter { !$0.isEmpty }
            guard !tokens.isEmpty else { return nil }
            return Trigger(tokens: tokens)
        }
    }

    private static func normalizeSegments(_ segments: [WakeWordSegment]) -> [Token] {
        segments.compactMap { segment in
            let normalized = VoiceWakeTextUtils.normalizeToken(segment.text)
            guard !normalized.isEmpty else { return nil }
            return Token(
                normalized: normalized,
                start: segment.start,
                end: segment.end,
                range: segment.range)
        }
    }

    private static func normalizeFreeText(_ text: String) -> String {
        text
            .split(whereSeparator: { $0.isWhitespace || $0.isPunctuation })
            .map { VoiceWakeTextUtils.normalizeToken(String($0)) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}

enum WakeWordSpeechSegments {
    static func from(
        transcription: SFTranscription,
        transcript: String)
    -> [WakeWordSegment] {
        transcription.segments.map { segment in
            let nsRange = segment.substringRange
            let range = Range(nsRange, in: transcript)
            return WakeWordSegment(
                text: segment.substring,
                start: segment.timestamp,
                duration: segment.duration,
                range: range)
        }
    }
}
