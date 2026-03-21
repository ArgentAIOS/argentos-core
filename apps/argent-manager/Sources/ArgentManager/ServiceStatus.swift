import Foundation

enum ServiceState: String {
    case running
    case starting
    case stopping
    case stopped
    case unknown
}

struct ServiceInfo: Identifiable {
    let id: String
    let label: String
    let launchdLabel: String
    let healthURL: URL?
    let port: Int
    var status: ServiceState
    var errorDetail: String?

    static let defaultServices: [ServiceInfo] = [
        ServiceInfo(
            id: "gateway",
            label: "Gateway",
            launchdLabel: "ai.argent.gateway",
            healthURL: URL(string: "http://localhost:18789"),
            port: 18789,
            status: .unknown
        ),
        ServiceInfo(
            id: "dashboard-ui",
            label: "Dashboard UI",
            launchdLabel: "ai.argent.dashboard-ui",
            healthURL: URL(string: "http://localhost:8080"),
            port: 8080,
            status: .unknown
        ),
        ServiceInfo(
            id: "dashboard-api",
            label: "Dashboard API",
            launchdLabel: "ai.argent.dashboard-api",
            healthURL: URL(string: "http://localhost:9242/api/health"),
            port: 9242,
            status: .unknown
        ),
    ]
}
