import SwiftUI

struct MenuContentView: View {
    @ObservedObject var serviceManager: ServiceManager
    @State private var showAbout = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Header with about info
            HStack {
                Image(systemName: "cpu")
                    .font(.system(size: 16))
                    .foregroundStyle(.green)
                VStack(alignment: .leading, spacing: 0) {
                    Text("ArgentOS")
                        .font(.headline)
                    Text("Personal AI Service Manager")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    showAbout.toggle()
                } label: {
                    Image(systemName: "info.circle")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
            }
            .padding(.bottom, 4)

            if showAbout {
                VStack(alignment: .leading, spacing: 4) {
                    Text("ArgentOS manages your local AI services — the Gateway (agent runtime), Dashboard UI (web interface), and Dashboard API (data backend).")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Services run as LaunchAgents and auto-start on login.")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    HStack(spacing: 12) {
                        Link("argentos.ai", destination: URL(string: "https://argentos.ai")!)
                            .font(.system(size: 11))
                        Link("Docs", destination: URL(string: "https://docs.argentos.ai")!)
                            .font(.system(size: 11))
                    }
                }
                .padding(8)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 6))
                .padding(.bottom, 4)
            }

            Divider()
                .padding(.vertical, 2)

            ForEach(serviceManager.services) { service in
                ServiceRow(service: service, serviceManager: serviceManager)
            }

            Divider()
                .padding(.vertical, 4)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Label("Meeting Capture", systemImage: "waveform.badge.mic")
                    Spacer(minLength: 0)
                    if serviceManager.meetingIsBusy {
                        ProgressView()
                            .controlSize(.small)
                    }
                }

                Text(serviceManager.meetingStatusMessage)
                    .font(.system(size: 10))
                    .foregroundStyle(
                        serviceManager.meetingErrorMessage?.isEmpty == false
                            ? .red
                            : (serviceManager.meetingIsRecording ? .green : .secondary))

                HStack(spacing: 8) {
                    Button {
                        Task {
                            if serviceManager.meetingIsRecording {
                                await serviceManager.stopMeetingRecording()
                            } else {
                                await serviceManager.startMeetingRecording()
                            }
                        }
                    } label: {
                        Label(
                            serviceManager.meetingIsRecording ? "Stop + Process" : "Start Recording",
                            systemImage: serviceManager.meetingIsRecording ? "stop.fill" : "record.circle")
                    }
                    .disabled(serviceManager.meetingIsBusy)
                    .buttonStyle(.borderedProminent)
                    .tint(serviceManager.meetingIsRecording ? .red : .green)
                    .controlSize(.small)

                    Button("Refresh") {
                        Task { await serviceManager.refreshMeetingStatus() }
                    }
                    .disabled(serviceManager.meetingIsBusy)
                    .buttonStyle(.bordered)
                    .controlSize(.small)

                    Button("Process Latest") {
                        Task { await serviceManager.processLatestMeeting() }
                    }
                    .disabled(serviceManager.meetingIsBusy)
                    .buttonStyle(.borderedProminent)
                    .tint(.blue)
                    .controlSize(.small)
                }

                Toggle("Live transcript while recording", isOn: $serviceManager.meetingLiveTranscriptOnStart)
                    .disabled(serviceManager.meetingIsBusy)
                Menu {
                    Button {
                        serviceManager.meetingSelectedMicDeviceId = "default"
                    } label: {
                        if serviceManager.meetingSelectedMicDeviceId == "default" {
                            Label("System Default", systemImage: "checkmark")
                        } else {
                            Text("System Default")
                        }
                    }
                    ForEach(serviceManager.meetingMicDevices) { device in
                        Button {
                            serviceManager.meetingSelectedMicDeviceId = device.id
                        } label: {
                            if serviceManager.meetingSelectedMicDeviceId == device.id {
                                Label(device.name, systemImage: "checkmark")
                            } else {
                                Text(device.name)
                            }
                        }
                    }
                } label: {
                    Label("Microphone: \(serviceManager.selectedMeetingMicLabel)", systemImage: "mic.fill")
                }
                .disabled(serviceManager.meetingIsBusy || !serviceManager.meetingCaptureMicOnStart)
                Toggle("Capture system audio (Zoom/Meet/browser)", isOn: $serviceManager.meetingCaptureSystemAudioOnStart)
                    .disabled(serviceManager.meetingIsBusy)
                Toggle("Capture microphone", isOn: $serviceManager.meetingCaptureMicOnStart)
                    .disabled(serviceManager.meetingIsBusy)
                Toggle("Auto-process on stop", isOn: $serviceManager.meetingAutoProcessOnStop)
                    .disabled(serviceManager.meetingIsBusy)
                Toggle("Create tasks from action items", isOn: $serviceManager.meetingCreateTasksOnProcess)
                    .disabled(serviceManager.meetingIsBusy)

                Text("System audio captures all macOS output; mic uses your current default macOS input device.")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Capture permissions: \(serviceManager.meetingPermissionLabel)")
                    .font(.system(size: 10))
                    .foregroundStyle(
                        serviceManager.meetingMicPermissionBlocked || serviceManager.meetingScreenPermissionBlocked
                            ? .red : .secondary)

                HStack(spacing: 8) {
                    Button("Mic Privacy") {
                        _ = serviceManager.openMeetingMicrophonePrivacySettings()
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)

                    Button("Screen/System Audio Privacy") {
                        _ = serviceManager.openMeetingScreenPrivacySettings()
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)

                    Button("Sound Input") {
                        _ = serviceManager.openMeetingSoundInputSettings()
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }

                Text("After granting permissions, stop/start recording again and click Refresh.")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let error = serviceManager.meetingErrorMessage,
                   !error.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(error)
                        .font(.system(size: 10))
                        .foregroundStyle(.red)
                        .lineLimit(2)
                } else if let result = serviceManager.meetingLastResult,
                          !result.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(result)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
            }

            Divider()
                .padding(.vertical, 4)

            Button {
                NSWorkspace.shared.open(URL(string: "http://localhost:8080")!)
            } label: {
                Label("Open Dashboard", systemImage: "globe")
            }
            .buttonStyle(.borderless)

            Button {
                NSWorkspace.shared.open(URL(string: "https://docs.argentos.ai")!)
            } label: {
                Label("Documentation", systemImage: "book")
            }
            .buttonStyle(.borderless)

            Divider()
                .padding(.vertical, 4)

            HStack(spacing: 8) {
                Button("Start All") {
                    Task { await serviceManager.startAll() }
                }
                .disabled(serviceManager.services.allSatisfy { $0.status == .running || $0.status == .starting })
                .buttonStyle(.borderedProminent)
                .tint(.green)

                Button("Stop All") {
                    Task { await serviceManager.stopAll() }
                }
                .disabled(serviceManager.services.allSatisfy { $0.status == .stopped || $0.status == .stopping })
                .buttonStyle(.borderedProminent)
                .tint(.red)

                Spacer()

                Button {
                    NSApplication.shared.terminate(nil)
                } label: {
                    Text("Quit")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .keyboardShortcut("q")
            }
        }
        .padding(12)
        .frame(width: 360)
        .task {
            await serviceManager.refreshMeetingStatus()
        }
    }
}

struct ServiceRow: View {
    let service: ServiceInfo
    let serviceManager: ServiceManager

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                // Status indicator
                ZStack {
                    if service.status == .starting || service.status == .stopping {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: 12, height: 12)
                    } else {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 10, height: 10)
                    }
                }
                .frame(width: 14)

                VStack(alignment: .leading, spacing: 1) {
                    Text(service.label)
                        .font(.system(size: 13, weight: .medium))
                    Text(statusText)
                        .font(.system(size: 10))
                        .foregroundStyle(service.errorDetail != nil ? .red : .secondary)
                }

                Spacer()

                Button {
                    Task {
                        if service.status == .running {
                            await serviceManager.stopService(id: service.id)
                        } else {
                            await serviceManager.startService(id: service.id)
                        }
                    }
                } label: {
                    Text(buttonLabel)
                        .font(.system(size: 11))
                        .frame(width: 44)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(service.status == .starting || service.status == .stopping)
            }

            // Error detail row
            if let error = service.errorDetail {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 9))
                        .foregroundStyle(.orange)
                    Text(error)
                        .font(.system(size: 10))
                        .foregroundStyle(.orange)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.leading, 22)
            }
        }
        .padding(.vertical, 3)
    }

    private var statusColor: Color {
        switch service.status {
        case .running: return .green
        case .stopped: return service.errorDetail != nil ? .orange : .red
        case .starting, .stopping: return .yellow
        case .unknown: return .gray
        }
    }

    private var statusText: String {
        switch service.status {
        case .running: return "Running on port \(service.port)"
        case .stopped:
            return service.errorDetail != nil ? "Failed to start" : "Stopped"
        case .starting: return "Starting..."
        case .stopping: return "Stopping..."
        case .unknown: return "Checking..."
        }
    }

    private var buttonLabel: String {
        switch service.status {
        case .running: return "Stop"
        case .starting: return "..."
        case .stopping: return "..."
        default: return "Start"
        }
    }
}
