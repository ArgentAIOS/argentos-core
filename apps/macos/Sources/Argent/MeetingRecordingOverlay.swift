import AppKit
import Observation
import QuartzCore
import SwiftUI

@MainActor
@Observable
final class MeetingRecordingOverlayController {
    static let shared = MeetingRecordingOverlayController()

    private(set) var isVisible = false
    private(set) var elapsedSeconds: Int = 0

    private var window: NSPanel?
    private var hostingView: NSHostingView<MeetingRecordingOverlayView>?
    private var timer: Timer?
    private var startDate: Date?

    private let width: CGFloat = 200
    private let height: CGFloat = 44

    func present() {
        self.elapsedSeconds = 0
        self.startDate = Date()
        self.ensureWindow()
        self.hostingView?.rootView = MeetingRecordingOverlayView(controller: self)

        guard let window else { return }
        let target = self.targetFrame()

        if !self.isVisible {
            self.isVisible = true
            window.setFrame(target, display: true)
            window.alphaValue = 0
            window.orderFrontRegardless()
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.18
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                window.animator().alphaValue = 1
            }
        } else {
            window.orderFrontRegardless()
        }

        self.timer?.invalidate()
        self.timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let start = self.startDate else { return }
                self.elapsedSeconds = Int(Date().timeIntervalSince(start))
            }
        }
    }

    func dismiss() {
        self.timer?.invalidate()
        self.timer = nil
        self.startDate = nil

        guard let window else {
            self.isVisible = false
            return
        }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.16
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            window.animator().alphaValue = 0
        } completionHandler: {
            Task { @MainActor in
                window.orderOut(nil)
                self.isVisible = false
            }
        }
    }

    var formattedTime: String {
        let m = self.elapsedSeconds / 60
        let s = self.elapsedSeconds % 60
        if m >= 60 {
            let h = m / 60
            return String(format: "%d:%02d:%02d", h, m % 60, s)
        }
        return String(format: "%d:%02d", m, s)
    }

    // MARK: - Private

    private func ensureWindow() {
        if self.window != nil { return }
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: self.width, height: self.height),
            styleMask: [.nonactivatingPanel, .borderless],
            backing: .buffered,
            defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.hidesOnDeactivate = false
        panel.isMovable = true
        panel.isMovableByWindowBackground = true
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true

        let host = NSHostingView(rootView: MeetingRecordingOverlayView(controller: self))
        host.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView = host
        self.hostingView = host
        self.window = panel
    }

    private func targetFrame() -> NSRect {
        guard let screen = NSScreen.main else { return .zero }
        let visible = screen.visibleFrame
        // Center horizontally near the top of the screen
        let x = visible.midX - self.width / 2
        let y = visible.maxY - self.height - 8
        return NSRect(x: x, y: y, width: self.width, height: self.height)
    }
}

private struct MeetingRecordingOverlayView: View {
    var controller: MeetingRecordingOverlayController

    var body: some View {
        HStack(spacing: 8) {
            // Pulsing red dot
            TimelineView(.animation(minimumInterval: 0.5)) { context in
                let pulse = sin(context.date.timeIntervalSinceReferenceDate * 3) * 0.3 + 0.7
                Circle()
                    .fill(Color.red)
                    .frame(width: 10, height: 10)
                    .opacity(pulse)
            }

            Text("REC")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(.red)

            Text(self.controller.formattedTime)
                .font(.system(size: 13, weight: .medium, design: .monospaced))
                .foregroundStyle(.primary)
                .monospacedDigit()

            Spacer()

            Button {
                Task { await MeetingCaptureStore.shared.stopRecording() }
            } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(.white)
                    .frame(width: 22, height: 22)
                    .background(Color.red.opacity(0.85))
                    .clipShape(RoundedRectangle(cornerRadius: 5))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(.ultraThinMaterial))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Color.red.opacity(0.3), lineWidth: 1))
    }
}
