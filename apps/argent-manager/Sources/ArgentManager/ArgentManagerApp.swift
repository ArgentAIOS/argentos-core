import SwiftUI

@main
struct ArgentManagerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var serviceManager = ServiceManager()

    var body: some Scene {
        MenuBarExtra("ArgentOS", systemImage: "cpu") {
            MenuContentView(serviceManager: serviceManager)
                .task {
                    await serviceManager.checkAllStatuses()
                }
                .task(id: "polling") {
                    await pollStatuses()
                }
        }
        .menuBarExtraStyle(.window)
    }

    private func pollStatuses() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            await serviceManager.checkAllStatuses()
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var setupWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)
        ensureCliWrapperIfRuntimePresent()

        if needsSetup() {
            showSetupWindow()
        } else {
            // Validate license in background on every launch
            Task { await validateLicenseOnStartup() }
        }
    }

    private func needsSetup() -> Bool {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let fm = FileManager.default
        let stateDir = "\(home)/.argentos"

        // Current + legacy auth store locations across installer generations.
        let authCandidates = [
            "\(stateDir)/agents/main/agent/auth-profiles.json",
            "\(stateDir)/agent/auth-profiles.json",
            "\(stateDir)/auth-profiles.json",
        ]
        if authCandidates.contains(where: { fm.fileExists(atPath: $0) }) {
            return false
        }

        // If config already contains provider keys or TTS key, treat setup as completed.
        let configPath = "\(stateDir)/argent.json"
        if fm.fileExists(atPath: configPath),
           let data = fm.contents(atPath: configPath),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           hasConfiguredKeys(json) {
            return false
        }

        // License alone isn't enough to run, but it indicates prior setup state.
        let licensePath = "\(stateDir)/license.json"
        if fm.fileExists(atPath: licensePath) {
            return false
        }

        return true
    }

    private func hasConfiguredKeys(_ config: [String: Any]) -> Bool {
        if let messages = config["messages"] as? [String: Any],
           let tts = messages["tts"] as? [String: Any],
           let elevenlabs = tts["elevenlabs"] as? [String: Any],
           let key = elevenlabs["apiKey"] as? String,
           !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return true
        }

        if let models = config["models"] as? [String: Any],
           let providers = models["providers"] as? [String: Any] {
            for providerCfg in providers.values {
                guard let cfg = providerCfg as? [String: Any] else { continue }
                if let key = cfg["apiKey"] as? String,
                   !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return true
                }
            }
        }

        if let env = config["env"] as? [String: Any],
           let vars = env["vars"] as? [String: Any] {
            let keyVars = [
                "ANTHROPIC_API_KEY",
                "OPENAI_API_KEY",
                "MINIMAX_API_KEY",
                "ZAI_API_KEY",
                "ELEVENLABS_API_KEY",
            ]
            for name in keyVars {
                if let value = vars[name] as? String,
                   !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return true
                }
            }
        }
        return false
    }

    private func validateLicenseOnStartup() async {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let licensePath = "\(home)/.argentos/license.json"

        guard FileManager.default.fileExists(atPath: licensePath),
              let data = FileManager.default.contents(atPath: licensePath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let key = json["key"] as? String, !key.isEmpty else {
            // No license file — show setup
            await MainActor.run { showSetupWindow() }
            return
        }

        // Validate against marketplace
        do {
            let url = URL(string: "https://marketplace.argentos.ai/api/v1/license/check/\(key)")!
            let (responseData, response) = try await URLSession.shared.data(from: url)

            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let result = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any],
                  let valid = result["valid"] as? Bool else {
                // Server unreachable — allow offline operation (grace period)
                return
            }

            if !valid {
                // License no longer valid — update the file and show setup
                var updated = json
                updated["validatedAt"] = ISO8601DateFormatter().string(from: Date())
                updated["status"] = result["status"] as? String ?? "invalid"
                if let updatedData = try? JSONSerialization.data(withJSONObject: updated, options: [.prettyPrinted]) {
                    try? updatedData.write(to: URL(fileURLWithPath: licensePath))
                }
                await MainActor.run { showSetupWindow() }
            } else {
                // Update validated timestamp
                var updated = json
                updated["validatedAt"] = ISO8601DateFormatter().string(from: Date())
                updated["status"] = "active"
                if let updatedData = try? JSONSerialization.data(withJSONObject: updated, options: [.prettyPrinted]) {
                    try? updatedData.write(to: URL(fileURLWithPath: licensePath))
                }
            }
        } catch {
            // Network error — allow offline operation
        }
    }

    private func showSetupWindow() {
        let setupView = SetupView(setupComplete: { [weak self] in
            self?.setupWindow?.close()
            self?.setupWindow = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                openDashboardURL()
            }
        })

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 500, height: 380),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "ArgentOS Setup"
        window.contentView = NSHostingView(rootView: setupView)
        window.center()
        window.makeKeyAndOrderFront(nil)
        window.isReleasedWhenClosed = false

        // Temporarily show in dock so the window is visible
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)

        self.setupWindow = window
    }

    private func ensureCliWrapperIfRuntimePresent() {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser.path
        let runtimeDir = "\(home)/.argentos/runtime"
        let nodePath = "\(runtimeDir)/bin/node"
        let agentScript = "\(runtimeDir)/argent.mjs"
        let binDir = "\(home)/bin"
        let wrapperPath = "\(binDir)/argent"
        let aliasPath = "\(binDir)/argentos"

        guard fm.fileExists(atPath: runtimeDir),
              fm.fileExists(atPath: nodePath),
              fm.fileExists(atPath: agentScript) else {
            return
        }

        do {
            if !fm.fileExists(atPath: binDir) {
                try fm.createDirectory(atPath: binDir, withIntermediateDirectories: true)
            }

            if !fm.fileExists(atPath: wrapperPath) {
                let wrapper = """
                #!/bin/bash
                ARGENT_HOME="\(runtimeDir)"
                export PATH="$ARGENT_HOME/bin:$PATH"
                cd "$ARGENT_HOME"
                exec "$ARGENT_HOME/bin/node" "$ARGENT_HOME/argent.mjs" "$@"
                """
                try wrapper.write(toFile: wrapperPath, atomically: true, encoding: .utf8)
                try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: wrapperPath)
            }

            if fm.fileExists(atPath: aliasPath) {
                try? fm.removeItem(atPath: aliasPath)
            }
            try fm.createSymbolicLink(atPath: aliasPath, withDestinationPath: wrapperPath)

            try ensurePathProfile("\(home)/.zshrc")
            try ensurePathProfile("\(home)/.bash_profile")
            try ensurePathProfile("\(home)/.bashrc")
        } catch {
            // Non-fatal: wrapper repair should never block launch.
        }
    }

    private func ensurePathProfile(_ profilePath: String) throws {
        let fm = FileManager.default
        if !fm.fileExists(atPath: profilePath) {
            fm.createFile(atPath: profilePath, contents: nil)
        }

        let existing = (try? String(contentsOfFile: profilePath, encoding: .utf8)) ?? ""
        if existing.contains("HOME/bin") {
            return
        }

        let block = """

        # ArgentOS
        export PATH="$HOME/bin:$PATH"
        """
        if let handle = FileHandle(forWritingAtPath: profilePath) {
            defer { try? handle.close() }
            try handle.seekToEnd()
            if let data = block.data(using: .utf8) {
                try handle.write(contentsOf: data)
            }
        }
    }
}
