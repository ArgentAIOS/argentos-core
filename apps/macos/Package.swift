// swift-tools-version: 6.2
// Package manifest for the Argent macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "Argent",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "ArgentIPC", targets: ["ArgentIPC"]),
        .library(name: "ArgentDiscovery", targets: ["ArgentDiscovery"]),
        .executable(name: "Argent", targets: ["Argent"]),
        .executable(name: "argent-mac", targets: ["ArgentMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/ArgentKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "ArgentIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "ArgentDiscovery",
            dependencies: [
                .product(name: "ArgentKit", package: "ArgentKit"),
            ],
            path: "Sources/ArgentDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Argent",
            dependencies: [
                "ArgentIPC",
                "ArgentDiscovery",
                .product(name: "ArgentKit", package: "ArgentKit"),
                .product(name: "ArgentChatUI", package: "ArgentKit"),
                .product(name: "ArgentProtocol", package: "ArgentKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/Argent.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "ArgentMacCLI",
            dependencies: [
                "ArgentDiscovery",
                .product(name: "ArgentKit", package: "ArgentKit"),
                .product(name: "ArgentProtocol", package: "ArgentKit"),
            ],
            path: "Sources/ArgentMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "ArgentIPCTests",
            dependencies: [
                "ArgentIPC",
                "Argent",
                "ArgentDiscovery",
                .product(name: "ArgentProtocol", package: "ArgentKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
