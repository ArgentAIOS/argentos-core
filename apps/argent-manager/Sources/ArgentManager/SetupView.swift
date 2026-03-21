import ServiceManagement
import SwiftUI

// MARK: - Setup Flow

private let OLLAMA_MODEL = "qwen3:30b-a3b-instruct-2507-q4_K_M"

struct SetupView: View {
    var setupComplete: () -> Void

    @State private var step: SetupStep = .welcome
    @State private var selectedProviders: Set<Provider> = []
    @State private var apiKeys: [Provider: String] = [:]
    @State private var currentKeyEntry: Provider? = nil
    @State private var isProcessing = false
    @State private var errorMessage: String?
    @State private var statusMessage = ""

    // Ollama state
    @State private var ollamaDetected = false
    @State private var ollamaModelReady = false
    @State private var ollamaPulling = false
    @State private var ollamaPullProgress = ""

    // License
    @State private var licenseKey = ""
    @State private var companyName = ""
    @State private var licenseValid = false
    @State private var licenseChecking = false
    @State private var licenseStatus = ""

    // ElevenLabs (optional voice)
    @State private var elevenLabsKey = ""

    private var runtimeDir: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/.argentos/runtime"
    }
    private var nodePath: String { "\(runtimeDir)/bin/node" }
    private var agentScript: String { "\(runtimeDir)/argent.mjs" }

    var body: some View {
        VStack(spacing: 0) {
            switch step {
            case .welcome:
                welcomeStep
            case .license:
                licenseStep
            case .pickProviders:
                pickProvidersStep
            case .enterKeys:
                enterKeysStep
            case .localModel:
                localModelStep
            case .voice:
                voiceStep
            case .installing:
                installingStep
            }
        }
        .frame(width: 480, height: 460)
        .animation(.easeInOut(duration: 0.25), value: step)
    }

    // MARK: Step 1 — Welcome

    private var welcomeStep: some View {
        VStack(spacing: 24) {
            Spacer()

            if let nsImage = NSImage(named: "AppIcon") {
                Image(nsImage: nsImage)
                    .resizable()
                    .frame(width: 96, height: 96)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .background(
                        RoundedRectangle(cornerRadius: 20).fill(.black)
                    )
            }

            VStack(spacing: 8) {
                Text("Welcome to ArgentOS")
                    .font(.title)
                    .fontWeight(.semibold)

                Text("Your personal AI operating system.")
                    .foregroundStyle(.secondary)
            }

            Button("Continue") {
                step = .license
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)

            Spacer()
        }
        .padding(40)
    }

    // MARK: Step 2 — License

    private var licenseStep: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "key.fill")
                .font(.system(size: 40))
                .foregroundStyle(.blue)

            VStack(spacing: 8) {
                Text("Activate ArgentOS")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text("Enter your license key to get started.")
                    .foregroundStyle(.secondary)
                    .font(.callout)
            }

            VStack(spacing: 12) {
                TextField("Company Name (optional)", text: $companyName)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 380)

                HStack(spacing: 8) {
                    TextField("aos_XXXX-XXXX-XXXX-XXXX", text: $licenseKey)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: licenseKey) { newValue in
                            // Auto-uppercase the key groups (keep aos_ prefix lowercase)
                            let transformed: String
                            if newValue.lowercased().hasPrefix("aos_") {
                                transformed = "aos_" + String(newValue.dropFirst(4)).uppercased()
                            } else {
                                transformed = newValue.uppercased()
                            }
                            if transformed != newValue { licenseKey = transformed }
                            licenseValid = false
                            licenseStatus = ""
                        }

                    if licenseChecking {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: 24)
                    } else if licenseValid {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .font(.title3)
                            .frame(width: 24)
                    } else if !licenseStatus.isEmpty {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.red)
                            .font(.title3)
                            .frame(width: 24)
                    } else {
                        Color.clear.frame(width: 24, height: 24)
                    }
                }
                .frame(maxWidth: 380)

                if !licenseStatus.isEmpty && !licenseValid {
                    Text(licenseStatus)
                        .foregroundStyle(.red)
                        .font(.caption)
                }
            }

            HStack(spacing: 12) {
                Button("Validate") {
                    Task { await validateLicense() }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(licenseKey.isEmpty || licenseChecking)
                .keyboardShortcut(.defaultAction)

                Button("Continue") {
                    step = .pickProviders
                }
                .controlSize(.large)
                .disabled(!licenseValid)
            }

            Spacer()
        }
        .padding(.horizontal, 40)
    }

    // MARK: Step 3 — Pick Providers

    private var pickProvidersStep: some View {
        VStack(spacing: 20) {
            Text("Choose Your Providers")
                .font(.title2)
                .fontWeight(.semibold)
                .padding(.top, 32)

            Text("Select one or more. You can add others later.")
                .foregroundStyle(.secondary)
                .font(.callout)

            VStack(spacing: 8) {
                ForEach(Provider.allCases) { provider in
                    providerCard(provider)
                }
            }
            .padding(.horizontal, 32)

            Spacer()

            Button("Next") {
                let ordered = Provider.allCases.filter { selectedProviders.contains($0) }
                currentKeyEntry = ordered.first
                step = .enterKeys
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(selectedProviders.isEmpty)
            .keyboardShortcut(.defaultAction)
            .padding(.bottom, 32)
        }
    }

    private func providerCard(_ provider: Provider) -> some View {
        let isSelected = selectedProviders.contains(provider)
        return Button {
            if isSelected {
                selectedProviders.remove(provider)
            } else {
                selectedProviders.insert(provider)
            }
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(provider.displayName)
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text(provider.models)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSelected ? .blue : .secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(isSelected ? Color.blue.opacity(0.08) : Color.gray.opacity(0.06))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(isSelected ? Color.blue.opacity(0.4) : Color.clear, lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: Step 3 — Enter Keys (one at a time)

    private var enterKeysStep: some View {
        let provider = currentKeyEntry ?? .anthropic
        let currentKey = Binding<String>(
            get: { apiKeys[provider] ?? "" },
            set: { apiKeys[provider] = $0 }
        )
        let orderedProviders = Provider.allCases.filter { selectedProviders.contains($0) }
        let currentIndex = orderedProviders.firstIndex(of: provider) ?? 0
        let isLast = currentIndex == orderedProviders.count - 1

        return VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 8) {
                Text(provider.displayName)
                    .font(.title2)
                    .fontWeight(.semibold)

                Text("Enter your \(provider.displayName) API key.")
                    .foregroundStyle(.secondary)
                    .font(.callout)

                if orderedProviders.count > 1 {
                    Text("\(currentIndex + 1) of \(orderedProviders.count)")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }

            SecureField(provider.placeholder, text: currentKey)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 380)

            if let error = errorMessage {
                Text(error)
                    .foregroundStyle(.red)
                    .font(.caption)
                    .frame(maxWidth: 380)
            }

            HStack(spacing: 12) {
                Button("Back") {
                    if currentIndex > 0 {
                        currentKeyEntry = orderedProviders[currentIndex - 1]
                    } else {
                        step = .pickProviders
                    }
                }
                .controlSize(.large)

                Button(isLast ? "Next" : "Next") {
                    if isLast {
                        // Check for Ollama before proceeding to install
                        Task { await checkOllama() }
                    } else {
                        currentKeyEntry = orderedProviders[currentIndex + 1]
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(currentKey.wrappedValue.isEmpty)
                .keyboardShortcut(.defaultAction)
            }

            Spacer()
        }
        .padding(40)
    }

    // MARK: Step 4 — Local Model (Ollama) — Required

    private var localModelStep: some View {
        VStack(spacing: 20) {
            Spacer()

            if ollamaDetected {
                Image(systemName: "desktopcomputer")
                    .font(.system(size: 40))
                    .foregroundStyle(.green)

                VStack(spacing: 8) {
                    Text("Local AI Ready")
                        .font(.title2)
                        .fontWeight(.semibold)

                    if ollamaModelReady {
                        Text("Ollama is running and your local model is ready.")
                            .foregroundStyle(.secondary)
                            .font(.callout)
                            .multilineTextAlignment(.center)

                        Text("Qwen3 30B will handle simple tasks for free.")
                            .foregroundStyle(.tertiary)
                            .font(.caption)
                    } else if ollamaPulling {
                        Text("Downloading Qwen3 30B for local inference...")
                            .foregroundStyle(.secondary)
                            .font(.callout)

                        ProgressView()
                            .controlSize(.small)

                        if !ollamaPullProgress.isEmpty {
                            Text(ollamaPullProgress)
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                                .frame(maxWidth: 350)
                        }
                    } else {
                        Text("Ollama is running. One more step — install the local model.")
                            .foregroundStyle(.secondary)
                            .font(.callout)
                            .multilineTextAlignment(.center)

                        Text("Qwen3 30B handles simple tasks locally — free, no API calls.")
                            .foregroundStyle(.tertiary)
                            .font(.caption)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 350)
                    }
                }
            } else {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 40))
                    .foregroundStyle(.orange)

                VStack(spacing: 8) {
                    Text("Install Ollama")
                        .font(.title2)
                        .fontWeight(.semibold)

                    Text("ArgentOS requires Ollama for local AI inference.\nAfter install, launch Ollama once, then return here.")
                        .foregroundStyle(.secondary)
                        .font(.callout)
                        .multilineTextAlignment(.center)
                }

                VStack(spacing: 12) {
                    Button {
                        NSWorkspace.shared.open(URL(string: "https://ollama.com/download")!)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.down.circle.fill")
                            Text("Download Ollama")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    VStack(spacing: 4) {
                        Text("1. Download and open the installer")
                        Text("2. Drag Ollama to Applications")
                        Text("3. Launch Ollama and keep it running")
                        Text("4. Come back here and tap Check Again")
                    }
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                }
            }

            Spacer()

            HStack(spacing: 12) {
                if !ollamaDetected {
                    Button("Check Again") {
                        Task { await checkOllama() }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .keyboardShortcut(.defaultAction)
                } else if ollamaDetected && !ollamaModelReady && !ollamaPulling {
                    Button("Install Model") {
                        Task { await pullOllamaModel() }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .keyboardShortcut(.defaultAction)
                } else if ollamaPulling {
                    // Just the progress — wait for it
                    EmptyView()
                } else {
                    Button("Continue") {
                        step = .voice
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .keyboardShortcut(.defaultAction)
                }
            }
            .padding(.bottom, 32)
        }
        .padding(.horizontal, 40)
    }

    // MARK: Step 5 — Voice (Optional)

    private var voiceStep: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "waveform.circle")
                .font(.system(size: 40))
                .foregroundStyle(.purple)

            VStack(spacing: 8) {
                Text("Give Your Agent a Voice")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text("For a more immersive experience, add an ElevenLabs API key.\nYour agent will speak to you during your first meeting.")
                    .foregroundStyle(.secondary)
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 380)

                Text("Optional — your device's built-in voice will be used if skipped.")
                    .foregroundStyle(.tertiary)
                    .font(.caption)
            }

            SecureField("xi-...", text: $elevenLabsKey)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 380)

            HStack(spacing: 12) {
                Button("Skip") {
                    step = .installing
                    Task { await runSetup() }
                }
                .controlSize(.large)

                Button("Continue") {
                    step = .installing
                    Task { await runSetup() }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)
            }

            Spacer()
        }
        .padding(40)
    }

    // MARK: Step 6 — Installing

    private var installingStep: some View {
        VStack(spacing: 24) {
            Spacer()

            ProgressView()
                .controlSize(.large)

            Text(statusMessage.isEmpty ? "Setting up..." : statusMessage)
                .font(.headline)
                .foregroundStyle(.secondary)

            if let error = errorMessage {
                Text(error)
                    .foregroundStyle(.red)
                    .font(.caption)
                    .frame(maxWidth: 380)

                Button("Retry") {
                    Task { await runSetup() }
                }
                .controlSize(.large)
            }

            Spacer()
        }
        .padding(40)
    }

    // MARK: - License Validation

    private func isValidKeyFormat(_ key: String) -> Bool {
        // Accept both new aos_ and legacy ARGENT- formats
        let pattern = "^(aos_|ARGENT-)[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$"
        return key.range(of: pattern, options: .regularExpression) != nil
    }

    private func validateLicense() async {
        let key = licenseKey.trimmingCharacters(in: .whitespaces)

        // Quick format check
        guard isValidKeyFormat(key) else {
            licenseStatus = "Invalid format. Expected: aos_XXXX-XXXX-XXXX-XXXX"
            licenseValid = false
            return
        }

        licenseChecking = true
        licenseStatus = ""

        do {
            let url = URL(string: "https://marketplace.argentos.ai/api/v1/license/check/\(key)")!
            let (data, response) = try await URLSession.shared.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse else {
                licenseStatus = "Unable to reach license server"
                licenseChecking = false
                return
            }

            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let valid = json["valid"] as? Bool ?? false

                if valid {
                    licenseValid = true
                    licenseStatus = ""

                    // Populate company name from org if user didn't enter one
                    if companyName.isEmpty, let orgName = json["orgName"] as? String {
                        companyName = orgName
                    }
                } else {
                    licenseValid = false
                    let reason = json["reason"] as? String ?? json["status"] as? String ?? "unknown"
                    switch reason {
                    case "not_found": licenseStatus = "License key not found"
                    case "expired": licenseStatus = "License has expired"
                    case "revoked": licenseStatus = "License has been revoked"
                    case "invalid_format": licenseStatus = "Invalid key format"
                    default: licenseStatus = "License is \(reason)"
                    }
                }
            } else {
                licenseStatus = "Invalid response from server"
            }
        } catch {
            licenseStatus = "Could not connect to license server"
        }

        licenseChecking = false
    }

    /// Save license info to ~/.argentos/license.json
    private func saveLicense() throws {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let dir = "\(home)/.argentos"
        let licensePath = "\(dir)/license.json"
        let fm = FileManager.default

        if !fm.fileExists(atPath: dir) {
            try fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
        }

        var license: [String: Any] = [
            "key": licenseKey,
            "validatedAt": ISO8601DateFormatter().string(from: Date()),
        ]
        if !companyName.isEmpty {
            license["companyName"] = companyName
        }

        let jsonData = try JSONSerialization.data(withJSONObject: license, options: [.prettyPrinted, .sortedKeys])
        try jsonData.write(to: URL(fileURLWithPath: licensePath))
    }

    // MARK: - Ollama Detection

    private func checkOllama() async {
        // Ping Ollama to see if it's running
        ollamaDetected = false
        ollamaModelReady = false

        do {
            let url = URL(string: "http://localhost:11434/api/tags")!
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                step = .localModel
                return
            }

            ollamaDetected = true

            // Check if the required model is already pulled
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let models = json["models"] as? [[String: Any]] {
                let modelNames = models.compactMap { $0["name"] as? String }
                // Check for exact match or prefix match (ollama sometimes appends :latest)
                let modelBase = OLLAMA_MODEL.split(separator: ":").first.map(String.init) ?? OLLAMA_MODEL
                ollamaModelReady = modelNames.contains(where: { name in
                    name == OLLAMA_MODEL || name.hasPrefix(modelBase)
                })
            }
        } catch {
            // Ollama not running — that's fine
            ollamaDetected = false
        }

        step = .localModel
    }

    private func pullOllamaModel() async {
        ollamaPulling = true
        ollamaPullProgress = "Starting download..."

        do {
            let url = URL(string: "http://localhost:11434/api/pull")!
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let body = try JSONSerialization.data(withJSONObject: ["name": OLLAMA_MODEL])
            request.httpBody = body

            // Use streaming to track progress
            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                ollamaPullProgress = "Download failed."
                ollamaPulling = false
                return
            }

            var lastStatus = ""
            for try await line in bytes.lines {
                if let lineData = line.data(using: String.Encoding.utf8),
                   let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] {
                    if let status = json["status"] as? String {
                        // Deduplicate repeated status messages
                        if status != lastStatus {
                            lastStatus = status
                            await MainActor.run {
                                if let completed = json["completed"] as? Int64,
                                   let total = json["total"] as? Int64, total > 0 {
                                    let pct = Int(Double(completed) / Double(total) * 100)
                                    ollamaPullProgress = "\(status) — \(pct)%"
                                } else {
                                    ollamaPullProgress = status
                                }
                            }
                        }
                    }
                }
            }

            ollamaModelReady = true
            ollamaPulling = false
            ollamaPullProgress = ""
        } catch {
            ollamaPullProgress = "Download failed: \(error.localizedDescription)"
            ollamaPulling = false
        }
    }

    // MARK: - Setup Logic

    private func runSetup() async {
        isProcessing = true
        errorMessage = nil

        do {
            // Save license first
            if licenseValid && !licenseKey.isEmpty {
                statusMessage = "Saving license..."
                try saveLicense()
            }

            statusMessage = "Installing runtime..."
            try copyBundledRuntime()

            statusMessage = "Installing CLI command..."
            try installCliWrapper()

            statusMessage = "Configuring providers..."
            var onboardArgs = [agentScript, "onboard", "--non-interactive", "--accept-risk"]

            for provider in Provider.allCases where selectedProviders.contains(provider) {
                if let key = apiKeys[provider], !key.isEmpty {
                    onboardArgs += [provider.cliFlag, key]
                }
            }

            try await runCommand(nodePath, arguments: onboardArgs)

            // Save ElevenLabs key to config if provided
            if !elevenLabsKey.isEmpty {
                statusMessage = "Configuring voice..."
                try saveElevenLabsKey(elevenLabsKey)
            }

            statusMessage = "Installing daemon..."
            try await runCommand(nodePath, arguments: [agentScript, "daemon", "install"])

            statusMessage = "Installing services..."
            try await runCommand(nodePath, arguments: [agentScript, "cs", "install"])

            statusMessage = "Finishing up..."
            registerLoginItem()

            statusMessage = ""
            NSApplication.shared.setActivationPolicy(.accessory)
            setupComplete()
        } catch {
            errorMessage = error.localizedDescription
        }

        isProcessing = false
    }

    /// Write the ElevenLabs API key into ~/.argentos/argent.json config
    private func saveElevenLabsKey(_ key: String) throws {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let configPath = "\(home)/.argentos/argent.json"
        let fm = FileManager.default

        // Ensure directory exists
        let dir = "\(home)/.argentos"
        if !fm.fileExists(atPath: dir) {
            try fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
        }

        // Load existing config or start fresh
        var config: [String: Any] = [:]
        if fm.fileExists(atPath: configPath),
           let data = fm.contents(atPath: configPath),
           let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            config = existing
        }

        // Merge: config.messages.tts.elevenlabs.apiKey and config.messages.tts.provider
        var messages = config["messages"] as? [String: Any] ?? [:]
        var tts = messages["tts"] as? [String: Any] ?? [:]
        var elevenlabs = tts["elevenlabs"] as? [String: Any] ?? [:]
        elevenlabs["apiKey"] = key
        tts["elevenlabs"] = elevenlabs
        tts["provider"] = "elevenlabs"
        tts["enabled"] = true
        messages["tts"] = tts
        config["messages"] = messages

        let jsonData = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys])
        try jsonData.write(to: URL(fileURLWithPath: configPath))
    }

    private func copyBundledRuntime() throws {
        let fm = FileManager.default
        let destURL = URL(fileURLWithPath: runtimeDir)
        let parentURL = destURL.deletingLastPathComponent()
        guard let bundleRuntime = Bundle.main.resourceURL?.appendingPathComponent("argent-runtime") else {
            throw SetupError.missingBundledRuntime
        }
        guard fm.fileExists(atPath: bundleRuntime.path) else {
            throw SetupError.missingBundledRuntime
        }

        let stagedURL = parentURL.appendingPathComponent(".runtime-staging-\(UUID().uuidString)")

        // Always refresh runtime to avoid stale hashed chunk imports from older builds.
        try fm.createDirectory(at: parentURL, withIntermediateDirectories: true)
        if fm.fileExists(atPath: stagedURL.path) {
            try fm.removeItem(at: stagedURL)
        }
        try fm.copyItem(at: bundleRuntime, to: stagedURL)

        guard runtimeLooksComplete(at: stagedURL) else {
            try? fm.removeItem(at: stagedURL)
            throw SetupError.runtimeIntegrityCheckFailed
        }

        if fm.fileExists(atPath: destURL.path) {
            try fm.removeItem(at: destURL)
        }
        try fm.moveItem(at: stagedURL, to: destURL)
    }

    private func installCliWrapper() throws {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser.path
        let binDir = "\(home)/bin"
        let wrapperPath = "\(binDir)/argent"
        let aliasPath = "\(binDir)/argentos"

        guard fm.fileExists(atPath: nodePath), fm.fileExists(atPath: agentScript) else {
            throw SetupError.missingBundledRuntime
        }

        if !fm.fileExists(atPath: binDir) {
            try fm.createDirectory(atPath: binDir, withIntermediateDirectories: true)
        }

        let wrapper = """
        #!/bin/bash
        ARGENT_HOME="\(runtimeDir)"
        export PATH="$ARGENT_HOME/bin:$PATH"
        cd "$ARGENT_HOME"
        exec "$ARGENT_HOME/bin/node" "$ARGENT_HOME/argent.mjs" "$@"
        """
        try wrapper.write(toFile: wrapperPath, atomically: true, encoding: .utf8)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: wrapperPath)

        if fm.fileExists(atPath: aliasPath) {
            try? fm.removeItem(atPath: aliasPath)
        }
        try fm.createSymbolicLink(atPath: aliasPath, withDestinationPath: wrapperPath)

        // Ensure shell startup files include ~/bin on PATH (fresh macOS installs may not have this).
        try ensurePathProfile("\(home)/.zshrc")
        try ensurePathProfile("\(home)/.bash_profile")
        try ensurePathProfile("\(home)/.bashrc")
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

    private func runtimeLooksComplete(at runtimeURL: URL) -> Bool {
        let fm = FileManager.default
        let agentURL = runtimeURL.appendingPathComponent("argent.mjs")

        guard let source = try? String(contentsOf: agentURL, encoding: .utf8) else {
            return false
        }

        // Ensure all relative JS imports from argent.mjs exist in the bundled runtime.
        let importPattern = #"import\s+(?:[^"']+\s+from\s+)?["'](\./[^"']+\.js)["'];"#
        guard let regex = try? NSRegularExpression(pattern: importPattern) else {
            return false
        }
        let nsSource = source as NSString
        let matches = regex.matches(in: source, range: NSRange(location: 0, length: nsSource.length))
        for match in matches {
            guard match.numberOfRanges > 1 else { continue }
            let relImport = nsSource.substring(with: match.range(at: 1))
            let relPath = String(relImport.dropFirst(2)) // strip "./"
            let importURL = runtimeURL.appendingPathComponent(relPath)
            if !fm.fileExists(atPath: importURL.path) {
                return false
            }
        }

        return true
    }

    private func runCommand(_ path: String, arguments: [String]) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let process = Process()
            let pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: path)
            process.arguments = arguments
            process.standardOutput = pipe
            process.standardError = pipe

            do {
                try process.run()
                process.waitUntilExit()
                if process.terminationStatus != 0 {
                    let data = pipe.fileHandleForReading.readDataToEndOfFile()
                    let output = String(data: data, encoding: .utf8) ?? "Unknown error"
                    continuation.resume(throwing: SetupError.commandFailed(output))
                } else {
                    continuation.resume()
                }
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    private func registerLoginItem() {
        try? SMAppService.mainApp.register()
    }
}

// MARK: - Models

enum SetupStep {
    case welcome, license, pickProviders, enterKeys, localModel, voice, installing
}

enum Provider: String, CaseIterable, Identifiable {
    case anthropic
    case minimax
    case glm

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .anthropic: return "Anthropic"
        case .minimax: return "MiniMax"
        case .glm: return "GLM / ZAI"
        }
    }

    var models: String {
        switch self {
        case .anthropic: return "Claude Opus, Sonnet, Haiku"
        case .minimax: return "MiniMax-M2.1"
        case .glm: return "GLM-4, ChatGLM"
        }
    }

    var placeholder: String {
        switch self {
        case .anthropic: return "sk-ant-..."
        case .minimax: return "minimax api key"
        case .glm: return "zai api key"
        }
    }

    var cliFlag: String {
        switch self {
        case .anthropic: return "--anthropic-api-key"
        case .minimax: return "--minimax-api-key"
        case .glm: return "--zai-api-key"
        }
    }
}

enum SetupError: LocalizedError {
    case missingBundledRuntime
    case runtimeIntegrityCheckFailed
    case commandFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingBundledRuntime:
            return "Bundled runtime not found in app resources."
        case .runtimeIntegrityCheckFailed:
            return "Bundled runtime failed integrity check (missing runtime modules)."
        case .commandFailed(let output):
            return "Command failed: \(output)"
        }
    }
}
