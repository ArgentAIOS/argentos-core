import Foundation

struct GatewayConfig {
    var mode: String?
    var bind: String?
    var port: Int?
    var remoteUrl: String?
    var token: String?
    var password: String?
    var remoteToken: String?
    var remotePassword: String?
}

private enum GatewayConfigPaths {
    static func pathEnv(_ key: String) -> String? {
        guard let raw = getenv(key) else { return nil }
        let value = String(cString: raw).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    static func stateDirURL() -> URL {
        if let override = self.pathEnv("ARGENT_STATE_DIR") {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return FileManager().homeDirectoryForCurrentUser
            .appendingPathComponent(".argentos", isDirectory: true)
    }

    static func configURL() -> URL {
        if let override = self.pathEnv("ARGENT_CONFIG_PATH") {
            return URL(fileURLWithPath: override, isDirectory: false)
        }
        let stateDir = self.stateDirURL()
        let candidate = stateDir.appendingPathComponent("argent.json", isDirectory: false)
        return candidate
    }
}

struct GatewayEndpoint {
    let url: URL
    let token: String?
    let password: String?
    let mode: String
}

func loadGatewayConfig() -> GatewayConfig {
    let url = GatewayConfigPaths.configURL()
    guard let data = try? Data(contentsOf: url) else { return GatewayConfig() }
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return GatewayConfig()
    }

    var cfg = GatewayConfig()
    if let gateway = json["gateway"] as? [String: Any] {
        cfg.mode = gateway["mode"] as? String
        cfg.bind = gateway["bind"] as? String
        cfg.port = gateway["port"] as? Int ?? parseInt(gateway["port"])

        if let auth = gateway["auth"] as? [String: Any] {
            cfg.token = auth["token"] as? String
            cfg.password = auth["password"] as? String
        }
        if let remote = gateway["remote"] as? [String: Any] {
            cfg.remoteUrl = remote["url"] as? String
            cfg.remoteToken = remote["token"] as? String
            cfg.remotePassword = remote["password"] as? String
        }
    }
    return cfg
}

func parseInt(_ value: Any?) -> Int? {
    switch value {
    case let number as Int:
        number
    case let number as Double:
        Int(number)
    case let raw as String:
        Int(raw.trimmingCharacters(in: .whitespacesAndNewlines))
    default:
        nil
    }
}
