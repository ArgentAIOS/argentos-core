// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "ArgentKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "ArgentProtocol", targets: ["ArgentProtocol"]),
        .library(name: "ArgentKit", targets: ["ArgentKit"]),
        .library(name: "ArgentChatUI", targets: ["ArgentChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
        .package(url: "https://github.com/gonzalezreal/textual", exact: "0.3.1"),
    ],
    targets: [
        .target(
            name: "ArgentProtocol",
            path: "Sources/ArgentProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "ArgentKit",
            dependencies: [
                "ArgentProtocol",
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            path: "Sources/ArgentKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "ArgentChatUI",
            dependencies: [
                "ArgentKit",
                .product(
                    name: "Textual",
                    package: "textual",
                    condition: .when(platforms: [.macOS, .iOS])),
            ],
            path: "Sources/ArgentChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "ArgentKitTests",
            dependencies: ["ArgentKit", "ArgentChatUI"],
            path: "Tests/ArgentKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
