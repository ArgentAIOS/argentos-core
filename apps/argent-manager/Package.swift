// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ArgentManager",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "ArgentManager", path: "Sources/ArgentManager")
    ]
)
