import Testing
@testable import Argent

@Suite(.serialized)
struct GatewayAutostartPolicyTests {
    @Test func startsGatewayOnlyWhenLocalAndNotPaused() {
        #expect(GatewayAutostartPolicy.shouldStartGateway(mode: .local, paused: false))
        #expect(!GatewayAutostartPolicy.shouldStartGateway(mode: .local, paused: true))
        #expect(!GatewayAutostartPolicy.shouldStartGateway(mode: .remote, paused: false))
        #expect(!GatewayAutostartPolicy.shouldStartGateway(mode: .unconfigured, paused: false))
    }

    @Test func ensuresLaunchAgentWhenLocalAndNotAttachOnly() {
        #expect(GatewayAutostartPolicy.shouldEnsureLaunchAgent(
            mode: .local,
            paused: false))
        #expect(!GatewayAutostartPolicy.shouldEnsureLaunchAgent(
            mode: .local,
            paused: true))
        #expect(!GatewayAutostartPolicy.shouldEnsureLaunchAgent(
            mode: .remote,
            paused: false))
    }

    @Test func attachOnlyDisablesGatewayAutostartAndLaunchAgent() {
        let args = ["Argent", "--attach-only"]
        #expect(!GatewayAutostartPolicy.shouldStartGateway(
            mode: .local,
            paused: false,
            args: args,
            env: [:]))
        #expect(!GatewayAutostartPolicy.shouldEnsureLaunchAgent(
            mode: .local,
            paused: false,
            args: args,
            env: [:]))
    }

    @Test func attachOnlyEnvDisablesGatewayAutostartAndLaunchAgent() {
        let env = ["ARGENT_ATTACH_ONLY": "1"]
        #expect(!GatewayAutostartPolicy.shouldStartGateway(
            mode: .local,
            paused: false,
            args: ["Argent"],
            env: env))
        #expect(!GatewayAutostartPolicy.shouldEnsureLaunchAgent(
            mode: .local,
            paused: false,
            args: ["Argent"],
            env: env))
    }
}
