import ArgumentParser
import AVFoundation
import CoreGraphics
import Foundation

/// Global atomic flag set by signal handler (C function pointers can't capture context).
private nonisolated(unsafe) var gStopRequested = false

private func handleSignal(_: Int32) {
    gStopRequested = true
}

@main
struct AudioCapture: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "argent-audio-capture",
        abstract: "Capture system audio and/or microphone to files for ArgentOS meeting recording."
    )

    @Option(name: .long, help: "Output directory for audio files")
    var outputDir: String?

    @Option(name: .long, help: "Base filename (without extension)")
    var baseName: String = "recording"

    @Flag(name: .long, help: "Capture system audio via ScreenCaptureKit")
    var systemAudio: Bool = false

    @Flag(name: .long, help: "Capture microphone input")
    var mic: Bool = false

    @Option(name: .long, help: "Microphone device id (uniqueID). Defaults to current macOS input.")
    var micDeviceId: String?

    @Flag(name: .long, help: "List microphone devices and capture permissions as JSON, then exit")
    var listMicDevices: Bool = false

    @Flag(
        name: .long,
        help: "When listing devices, request macOS capture permissions if not determined"
    )
    var requestPermissions: Bool = false

    @Option(name: .long, help: "Path to JSON control file for status updates")
    var controlFile: String?

    @Option(name: .long, help: "Optional file path to redirect stdout/stderr")
    var logFile: String?

    mutating func run() async throws {
        if let path = logFile, let pathCString = (path as NSString).utf8String {
            freopen(pathCString, "a", stdout)
            freopen(pathCString, "a", stderr)
        }

        if listMicDevices {
            try printMicDevicesJson(requestPermissions: requestPermissions)
            return
        }

        guard let outputDir = outputDir?.trimmingCharacters(in: .whitespacesAndNewlines), !outputDir.isEmpty else {
            print("Error: --output-dir is required when recording")
            throw ExitCode.failure
        }

        guard systemAudio || mic else {
            print("Error: at least one of --system-audio or --mic is required")
            throw ExitCode.failure
        }

        // Ensure output directory exists
        try FileManager.default.createDirectory(
            atPath: outputDir,
            withIntermediateDirectories: true
        )

        let systemPath = systemAudio ? "\(outputDir)/\(baseName)-system.m4a" : nil
        let micPath = mic ? "\(outputDir)/\(baseName)-mic.wav" : nil
        let ctlPath = controlFile

        let service = await AudioCaptureService()

        // Install signal handlers
        signal(SIGINT, handleSignal)
        signal(SIGTERM, handleSignal)

        // Start capture
        do {
            try await service.start(
                systemAudioPath: systemPath,
                micPath: micPath,
                captureSystemAudio: systemAudio,
                captureMic: mic,
                micDeviceUID: micDeviceId
            )
        } catch {
            print("Error starting capture: \(error.localizedDescription)")
            throw ExitCode.failure
        }

        if let micDeviceId, !micDeviceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            print("Recording started (system=\(systemAudio) mic=\(mic), micDeviceId=\(micDeviceId))")
        } else {
            print("Recording started (system=\(systemAudio) mic=\(mic))")
        }
        print("Press Ctrl+C to stop...")

        // Write initial control file
        writeControlFile(
            controlPath: ctlPath,
            status: "recording",
            durationSec: 0,
            systemPath: systemPath,
            micPath: micPath
        )

        // Poll for stop signal or control file change every second
        while !gStopRequested {
            try? await Task.sleep(nanoseconds: 1_000_000_000) // 1s
            if gStopRequested { break }

            let duration = await service.durationSec
            // Update control file every 5s (check modulo)
            if duration % 5 == 0 {
                writeControlFile(
                    controlPath: ctlPath,
                    status: "recording",
                    durationSec: duration,
                    systemPath: systemPath,
                    micPath: micPath
                )
            }

            // Check if control file was modified to "stop"
            if let path = ctlPath, checkShouldStop(controlPath: path) {
                break
            }
        }

        // Graceful shutdown
        print("\nStopping capture...")
        try await service.stop()

        let duration = await service.durationSec
        writeControlFile(
            controlPath: ctlPath,
            status: "stopped",
            durationSec: duration,
            systemPath: systemPath,
            micPath: micPath
        )

        print("Recording stopped. Duration: \(duration)s")
        if let p = systemPath { print("System audio: \(p)") }
        if let p = micPath { print("Mic audio: \(p)") }
    }
}

// MARK: - Device + Permission Reporting

private struct MicDevice: Codable {
    let id: String
    let name: String
    let isDefault: Bool
}

private struct CaptureDeviceReport: Codable {
    let ok: Bool
    let microphonePermission: String
    let screenCapturePermission: Bool
    let defaultMicDeviceId: String?
    let defaultMicDeviceName: String?
    let micDevices: [MicDevice]
}

private func microphonePermissionString() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
        return "authorized"
    case .denied:
        return "denied"
    case .restricted:
        return "restricted"
    case .notDetermined:
        return "not_determined"
    @unknown default:
        return "unknown"
    }
}

private func requestMicrophoneAccessIfNeeded() {
    guard AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined else { return }
    let semaphore = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .audio) { _ in
        semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 8)
}

private func requestScreenCaptureAccessIfNeeded() {
    guard !CGPreflightScreenCaptureAccess() else { return }
    _ = CGRequestScreenCaptureAccess()
}

private func printMicDevicesJson(requestPermissions: Bool) throws {
    if requestPermissions {
        requestMicrophoneAccessIfNeeded()
        requestScreenCaptureAccessIfNeeded()
    }

    let defaultMic = AVCaptureDevice.default(for: .audio)
    let defaultId = defaultMic?.uniqueID
    let discovery = AVCaptureDevice.DiscoverySession(
        deviceTypes: [.builtInMicrophone, .externalUnknown],
        mediaType: .audio,
        position: .unspecified
    )
    let devices = discovery.devices.map { dev in
        MicDevice(
            id: dev.uniqueID,
            name: dev.localizedName,
            isDefault: dev.uniqueID == defaultId
        )
    }
    let report = CaptureDeviceReport(
        ok: true,
        microphonePermission: microphonePermissionString(),
        screenCapturePermission: CGPreflightScreenCaptureAccess(),
        defaultMicDeviceId: defaultId,
        defaultMicDeviceName: defaultMic?.localizedName,
        micDevices: devices
    )
    let encoder = JSONEncoder()
    let data = try encoder.encode(report)
    if let json = String(data: data, encoding: .utf8) {
        print(json)
    } else {
        throw ExitCode.failure
    }
}

// MARK: - Control File Helpers

private func writeControlFile(
    controlPath: String?,
    status: String,
    durationSec: Int,
    systemPath: String?,
    micPath: String?
) {
    guard let controlPath else { return }
    let pid = ProcessInfo.processInfo.processIdentifier
    let now = ISO8601DateFormatter().string(from: Date())
    var json: [String: Any] = [
        "pid": pid,
        "startedAt": now,
        "durationSec": durationSec,
        "status": status,
    ]
    if let systemPath { json["systemAudioPath"] = systemPath }
    if let micPath { json["micPath"] = micPath }

    if let data = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys]) {
        try? data.write(to: URL(fileURLWithPath: controlPath))
    }
}

private func checkShouldStop(controlPath: String) -> Bool {
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: controlPath)),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let status = json["status"] as? String
    else { return false }
    return status == "stop"
}
