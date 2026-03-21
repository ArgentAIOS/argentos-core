import Foundation
import Testing
@testable import Argent

@Suite(.serialized)
struct ArgentConfigFileTests {
    @Test
    func configPathRespectsEnvOverride() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("argent-config-\(UUID().uuidString)")
            .appendingPathComponent("openclaw.json")
            .path

        await TestIsolation.withEnvValues(["OPENCLAW_CONFIG_PATH": override]) {
            #expect(ArgentConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func remoteGatewayPortParsesAndMatchesHost() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("argent-config-\(UUID().uuidString)")
            .appendingPathComponent("openclaw.json")
            .path

        await TestIsolation.withEnvValues(["OPENCLAW_CONFIG_PATH": override]) {
            ArgentConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://gateway.ts.net:19999",
                    ],
                ],
            ])
            #expect(ArgentConfigFile.remoteGatewayPort() == 19999)
            #expect(ArgentConfigFile.remoteGatewayPort(matchingHost: "gateway.ts.net") == 19999)
            #expect(ArgentConfigFile.remoteGatewayPort(matchingHost: "gateway") == 19999)
            #expect(ArgentConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
        }
    }

    @MainActor
    @Test
    func setRemoteGatewayUrlPreservesScheme() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("argent-config-\(UUID().uuidString)")
            .appendingPathComponent("openclaw.json")
            .path

        await TestIsolation.withEnvValues(["OPENCLAW_CONFIG_PATH": override]) {
            ArgentConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            ArgentConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = ArgentConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @Test
    func stateDirOverrideSetsConfigPath() async {
        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("argent-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "OPENCLAW_CONFIG_PATH": nil,
            "OPENCLAW_STATE_DIR": dir,
        ]) {
            #expect(ArgentConfigFile.stateDirURL().path == dir)
            #expect(ArgentConfigFile.url().path == "\(dir)/openclaw.json")
        }
    }
}
