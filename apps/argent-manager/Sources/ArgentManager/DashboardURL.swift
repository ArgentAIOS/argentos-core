import AppKit
import Foundation

private let defaultDashboardURL = "http://127.0.0.1:8080/"

func resolveDashboardURL() -> URL? {
    let base = ProcessInfo.processInfo.environment["ARGENT_DASHBOARD_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines)
    let baseURL: String
    if let base, !base.isEmpty {
        baseURL = base
    } else {
        baseURL = defaultDashboardURL
    }

    guard var components = URLComponents(string: baseURL) else {
        return URL(string: baseURL)
    }

    if let token = loadGatewayAuthToken(), !token.isEmpty {
        var items = components.queryItems ?? []
        items.removeAll(where: { $0.name == "token" })
        items.append(URLQueryItem(name: "token", value: token))
        components.queryItems = items
    }

    return components.url
}

func openDashboardURL() {
    guard let url = resolveDashboardURL() else {
        return
    }
    NSWorkspace.shared.open(url)
}

private func loadGatewayAuthToken() -> String? {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let configPath = "\(home)/.argentos/argent.json"
    guard
        let data = FileManager.default.contents(atPath: configPath),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let gateway = json["gateway"] as? [String: Any],
        let auth = gateway["auth"] as? [String: Any],
        let token = auth["token"] as? String
    else {
        return nil
    }
    let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}
