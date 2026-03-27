import Foundation

public struct ArgentChatSessionsDefaults: Codable, Sendable {
    public let model: String?
    public let contextTokens: Int?
}

public struct ArgentChatSessionEntry: Codable, Identifiable, Sendable, Hashable {
    public var id: String { self.key }

    public let key: String
    public let kind: String?
    public let displayName: String?
    public let surface: String?
    public let subject: String?
    public let room: String?
    public let space: String?
    public let updatedAt: Double?
    public let sessionId: String?

    public let systemSent: Bool?
    public let abortedLastRun: Bool?
    public let thinkingLevel: String?
    public let verboseLevel: String?

    public let inputTokens: Int?
    public let outputTokens: Int?
    public let totalTokens: Int?

    public let model: String?
    public let contextTokens: Int?
}

public struct ArgentChatSessionsListResponse: Codable, Sendable {
    public let ts: Double?
    public let path: String?
    public let count: Int?
    public let defaults: ArgentChatSessionsDefaults?
    public let sessions: [ArgentChatSessionEntry]
}

private func normalizedSessionKey(_ raw: String?) -> String {
    raw?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
}

private func sessionAgentId(from sessionKey: String) -> String? {
    let key = normalizedSessionKey(sessionKey)
    guard key.hasPrefix("agent:") else { return nil }
    let parts = key.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count >= 3 else { return nil }
    let agentId = String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines)
    return agentId.isEmpty ? nil : agentId
}

private func sessionRestKey(_ sessionKey: String) -> String {
    let key = normalizedSessionKey(sessionKey)
    guard key.hasPrefix("agent:") else { return key }
    let parts = key.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count >= 3 else { return key }
    return parts.dropFirst(2).joined(separator: ":")
}

private func sessionSurface(_ entry: ArgentChatSessionEntry) -> String {
    let explicit = normalizedSessionKey(entry.surface)
    if !explicit.isEmpty {
        return explicit
    }
    let raw = sessionRestKey(entry.key)
    guard !raw.isEmpty else { return "" }
    if raw == "global" || raw == "unknown" {
        return raw
    }
    let separators = CharacterSet(charactersIn: ":-")
    let token = raw.components(separatedBy: separators).first ?? raw
    return token.lowercased()
}

private func isBackgroundSession(_ sessionKey: String) -> Bool {
    let raw = sessionRestKey(sessionKey)
    guard !raw.isEmpty else { return false }
    return raw.hasPrefix("temp:")
        || raw.hasPrefix("temp-")
        || raw == "worker-execution"
        || raw.contains(":worker-execution")
        || raw.hasSuffix(":contemplation")
        || raw.contains(":contemplation:")
        || raw.hasSuffix(":sis-consolidation")
        || raw.contains(":sis-consolidation:")
        || raw.hasSuffix(":heartbeat")
        || raw.contains(":heartbeat:")
        || raw.hasSuffix(":cron")
        || raw.contains(":cron:")
}

private func isVisibleOperatorSession(
    _ entry: ArgentChatSessionEntry,
    currentSessionKey: String
) -> Bool {
    let key = normalizedSessionKey(entry.key)
    guard !key.isEmpty else { return false }
    if isBackgroundSession(key) {
        return false
    }

    let activeAgentId = sessionAgentId(from: currentSessionKey) ?? "main"
    let entryAgentId = sessionAgentId(from: key) ?? activeAgentId
    guard entryAgentId == activeAgentId else {
        return false
    }

    if key == normalizedSessionKey(currentSessionKey) {
        return true
    }

    let surface = sessionSurface(entry)
    return surface == "main" || surface == "webchat"
}

extension Array where Element == ArgentChatSessionEntry {
    func filteredVisibleOperatorSessions(currentSessionKey: String) -> [ArgentChatSessionEntry] {
        self.filter { isVisibleOperatorSession($0, currentSessionKey: currentSessionKey) }
    }
}
