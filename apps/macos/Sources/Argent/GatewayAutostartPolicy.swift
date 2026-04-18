import Foundation

enum GatewayAutostartPolicy {
    private static func truthy(_ raw: String?) -> Bool {
        guard let raw else { return false }
        switch raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "1", "true", "yes", "on":
            return true
        default:
            return false
        }
    }

    static func attachOnlyActive(
        args: [String] = CommandLine.arguments,
        env: [String: String] = ProcessInfo.processInfo.environment) -> Bool
    {
        args.contains("--attach-only") || self.truthy(env["ARGENT_ATTACH_ONLY"])
    }

    static func shouldStartGateway(
        mode: AppState.ConnectionMode,
        paused: Bool,
        args: [String] = CommandLine.arguments,
        env: [String: String] = ProcessInfo.processInfo.environment) -> Bool
    {
        mode == .local && !paused && !self.attachOnlyActive(args: args, env: env)
    }

    static func shouldEnsureLaunchAgent(
        mode: AppState.ConnectionMode,
        paused: Bool,
        args: [String] = CommandLine.arguments,
        env: [String: String] = ProcessInfo.processInfo.environment) -> Bool
    {
        self.shouldStartGateway(mode: mode, paused: paused, args: args, env: env)
    }
}
