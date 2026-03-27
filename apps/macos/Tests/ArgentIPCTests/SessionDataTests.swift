import Foundation
import Testing
@testable import Argent

@Suite
struct SessionDataTests {
    @Test func sessionKindFromKeyDetectsCommonKinds() {
        #expect(SessionKind.from(key: "global") == .global)
        #expect(SessionKind.from(key: "discord:group:engineering") == .group)
        #expect(SessionKind.from(key: "unknown") == .unknown)
        #expect(SessionKind.from(key: "user@example.com") == .direct)
    }

    @Test func sessionTokenStatsFormatKTokensRoundsAsExpected() {
        #expect(SessionTokenStats.formatKTokens(999) == "999")
        #expect(SessionTokenStats.formatKTokens(1000) == "1.0k")
        #expect(SessionTokenStats.formatKTokens(12340) == "12k")
    }

    @Test func sessionTokenStatsPercentUsedClampsTo100() {
        let stats = SessionTokenStats(input: 0, output: 0, total: 250_000, contextTokens: 200_000)
        #expect(stats.percentUsed == 100)
    }

    @Test func sessionRowFlagLabelsIncludeNonDefaultFlags() {
        let row = SessionRow(
            id: "x",
            key: "user@example.com",
            kind: .direct,
            displayName: nil,
            provider: nil,
            subject: nil,
            room: nil,
            space: nil,
            updatedAt: Date(),
            sessionId: nil,
            thinkingLevel: "high",
            verboseLevel: "debug",
            systemSent: true,
            abortedLastRun: true,
            tokens: SessionTokenStats(input: 1, output: 2, total: 3, contextTokens: 10),
            model: nil)
        #expect(row.flagLabels.contains("think high"))
        #expect(row.flagLabels.contains("verbose debug"))
        #expect(row.flagLabels.contains("system sent"))
        #expect(row.flagLabels.contains("aborted"))
    }

    @Test func visibleOperatorSessionFiltersToMainAgentWebchatOnly() {
        let mainKey = "agent:argent:main"
        let visibleMain = SessionRow(
            id: "main",
            key: "agent:argent:main",
            kind: .direct,
            displayName: nil,
            provider: nil,
            subject: nil,
            room: nil,
            space: nil,
            updatedAt: Date(),
            sessionId: nil,
            thinkingLevel: nil,
            verboseLevel: nil,
            systemSent: false,
            abortedLastRun: false,
            tokens: SessionTokenStats(input: 0, output: 0, total: 0, contextTokens: 10),
            model: nil)
        let visibleWebchat = SessionRow(
            id: "webchat",
            key: "agent:argent:webchat-1",
            kind: .direct,
            displayName: nil,
            provider: nil,
            subject: nil,
            room: nil,
            space: nil,
            updatedAt: Date(),
            sessionId: nil,
            thinkingLevel: nil,
            verboseLevel: nil,
            systemSent: false,
            abortedLastRun: false,
            tokens: SessionTokenStats(input: 0, output: 0, total: 0, contextTokens: 10),
            model: nil)
        let hiddenBackground = SessionRow(
            id: "background",
            key: "agent:argent:main:contemplation",
            kind: .direct,
            displayName: nil,
            provider: nil,
            subject: nil,
            room: nil,
            space: nil,
            updatedAt: Date(),
            sessionId: nil,
            thinkingLevel: nil,
            verboseLevel: nil,
            systemSent: false,
            abortedLastRun: false,
            tokens: SessionTokenStats(input: 0, output: 0, total: 0, contextTokens: 10),
            model: nil)
        let hiddenOtherAgent = SessionRow(
            id: "other",
            key: "agent:elon:webchat-1",
            kind: .direct,
            displayName: nil,
            provider: nil,
            subject: nil,
            room: nil,
            space: nil,
            updatedAt: Date(),
            sessionId: nil,
            thinkingLevel: nil,
            verboseLevel: nil,
            systemSent: false,
            abortedLastRun: false,
            tokens: SessionTokenStats(input: 0, output: 0, total: 0, contextTokens: 10),
            model: nil)

        #expect(isVisibleOperatorSession(visibleMain, mainSessionKey: mainKey))
        #expect(isVisibleOperatorSession(visibleWebchat, mainSessionKey: mainKey))
        #expect(!isVisibleOperatorSession(hiddenBackground, mainSessionKey: mainKey))
        #expect(!isVisibleOperatorSession(hiddenOtherAgent, mainSessionKey: mainKey))
    }
}
