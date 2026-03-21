import AVFoundation
import ArgentProtocol
import SwiftUI

struct VoicePreset: Identifiable {
    let id: String
    let name: String
    let voiceId: String
    let description: String

    static let presets: [VoicePreset] = [
        VoicePreset(
            id: "warm-guide",
            name: "Warm Guide",
            voiceId: "cgSgspJ2msm6clMCkdW9",
            description: "Jessica — clear, approachable, and reassuring."),
        VoicePreset(
            id: "calm-companion",
            name: "Calm Companion",
            voiceId: "pFZP5JQG7iQjIQuC4Bku",
            description: "Lily — soft-spoken, steady, and thoughtful."),
        VoicePreset(
            id: "energetic-operator",
            name: "Energetic Operator",
            voiceId: "9BWtsMINqrJLrRacOk9x",
            description: "Aria — bright, quick, and confident."),
        VoicePreset(
            id: "executive-brief",
            name: "Executive Brief",
            voiceId: "pNInz6obpgDQGcFmaJgB",
            description: "Adam — deep, measured, and authoritative."),
    ]
}

extension OnboardingView {
    func voiceChoicePage() -> some View {
        self.onboardingPage {
            Text("Choose a voice")
                .font(.largeTitle.weight(.semibold))
            Text(
                "Pick a personality for your agent's voice. " +
                    "You can change this anytime in Settings.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 520)
                .fixedSize(horizontal: false, vertical: true)

            self.onboardingCard(spacing: 12, padding: 14) {
                ForEach(VoicePreset.presets) { preset in
                    self.voicePresetRow(preset)
                }
            }
        }
    }

    private func voicePresetRow(_ preset: VoicePreset) -> some View {
        let isSelected = self.selectedVoiceId == preset.voiceId
        return Button {
            self.selectedVoiceId = preset.voiceId
            Task { await self.persistVoiceSelection(preset.voiceId) }
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(preset.name)
                        .font(.callout.weight(.semibold))
                    Text(preset.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                Button {
                    Task { await self.previewVoice(preset) }
                } label: {
                    if self.previewingVoiceId == preset.voiceId {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: 28, height: 28)
                    } else {
                        Image(systemName: "play.circle.fill")
                            .font(.title2)
                            .foregroundStyle(Color.accentColor)
                            .frame(width: 28, height: 28)
                    }
                }
                .buttonStyle(.plain)
                .disabled(self.previewingVoiceId != nil)

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.accentColor)
                } else {
                    Image(systemName: "circle")
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(isSelected ? Color.accentColor.opacity(0.12) : Color.clear))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(
                        isSelected ? Color.accentColor.opacity(0.45) : Color.clear,
                        lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    func previewVoice(_ preset: VoicePreset) async {
        guard self.previewingVoiceId == nil else { return }
        self.previewingVoiceId = preset.voiceId
        defer { self.previewingVoiceId = nil }

        do {
            let data = try await GatewayConnection.shared.requestRaw(
                method: .ttsConvert,
                params: [
                    "text": AnyCodable("Hey — I'm here. Let's figure this out together."),
                    "overrides": AnyCodable([
                        "elevenlabs": ["voiceId": preset.voiceId],
                    ]),
                ],
                timeoutMs: 15000)

            // The response is JSON with a base64 "audio" field
            struct TtsConvertResponse: Decodable {
                let audio: String?
                let audioPath: String?
            }
            let response = try JSONDecoder().decode(TtsConvertResponse.self, from: data)
            guard let base64Audio = response.audio,
                  let audioData = Data(base64Encoded: base64Audio)
            else { return }

            let tempURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("voice-preview-\(preset.id).mp3")
            try audioData.write(to: tempURL)
            let player = try AVAudioPlayer(contentsOf: tempURL)
            self.voicePreviewPlayer = player
            player.play()
        } catch {
            // Best-effort preview — don't block onboarding for TTS errors.
        }
    }

    func persistVoiceSelection(_ voiceId: String) async {
        do {
            try await GatewayConnection.shared.requestVoid(
                method: .configPatch,
                params: [
                    "patch": AnyCodable([
                        "tts": ["elevenlabs": ["voiceId": voiceId]],
                    ]),
                ])
        } catch {
            // Best-effort persistence.
        }
    }

    func checkElevenLabsAvailability() async {
        do {
            struct TtsStatusResponse: Decodable {
                let hasElevenLabsKey: Bool?
                let hasElevenlabsKey: Bool?

                var available: Bool {
                    self.hasElevenLabsKey ?? self.hasElevenlabsKey ?? false
                }
            }
            let response: TtsStatusResponse = try await GatewayConnection.shared.requestDecoded(
                method: .ttsStatus,
                timeoutMs: 10000)
            await MainActor.run {
                self.showVoiceChoice = response.available
            }
        } catch {
            await MainActor.run {
                self.showVoiceChoice = false
            }
        }
    }
}
