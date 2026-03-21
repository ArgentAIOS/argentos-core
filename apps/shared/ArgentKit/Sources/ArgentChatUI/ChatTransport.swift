import Foundation

public enum ArgentChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(ArgentChatEventPayload)
    case agent(ArgentAgentEventPayload)
    case seqGap
}

public protocol ArgentChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> ArgentChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [ArgentChatAttachmentPayload]) async throws -> ArgentChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> ArgentChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<ArgentChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension ArgentChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "ArgentChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> ArgentChatSessionsListResponse {
        throw NSError(
            domain: "ArgentChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}
