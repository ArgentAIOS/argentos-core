import AppKit
import ArgentIPC
import Foundation
import WebKit

@MainActor
final class DashboardWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private(set) var dashboardURL: URL
    private let webView: WKWebView

    init(dashboardURL: URL) {
        self.dashboardURL = dashboardURL
        let config = WKWebViewConfiguration()
        config.preferences.isElementFullscreenEnabled = true
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let nativeVoiceFlagScript = WKUserScript(
            source: """
            window.__argentNativeVoiceActive = true;
            window.__argentNativeSpeechActive = true;
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true)
        config.userContentController.addUserScript(nativeVoiceFlagScript)
        self.webView = WKWebView(frame: .zero, configuration: config)
        self.webView.setValue(true, forKey: "drawsBackground")

        let visibleFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let initialWidth = min(max(1260, visibleFrame.width * 0.86), visibleFrame.width)
        let initialHeight = min(max(860, visibleFrame.height * 0.86), visibleFrame.height)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: initialWidth, height: initialHeight),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false)
        window.title = "Argent Dashboard"
        window.minSize = NSSize(width: 960, height: 640)
        window.contentView = self.webView
        window.styleMask.insert(.resizable)
        let autosaveName = NSWindow.FrameAutosaveName("ArgentDashboardWindow")
        window.setFrameAutosaveName(autosaveName)
        if !window.setFrameUsingName(autosaveName) {
            window.center()
        }

        super.init(window: window)
        self.webView.navigationDelegate = self
        self.webView.uiDelegate = self
        self.webView.configuration.userContentController.add(self, name: "argentNativeVoiceEvent")
        self.webView.configuration.userContentController.add(self, name: "argentNativeSpeechEvent")
        self.load(url: dashboardURL)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    deinit {
        self.webView.configuration.userContentController.removeScriptMessageHandler(forName: "argentNativeVoiceEvent")
        self.webView.configuration.userContentController.removeScriptMessageHandler(forName: "argentNativeSpeechEvent")
    }

    func show() {
        guard let window else { return }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "argentNativeSpeechEvent" {
            guard let body = message.body as? [String: Any],
                  let kind = body["kind"] as? String
            else { return }
            Task { @MainActor in
                switch kind {
                case "start":
                    let granted = await PermissionManager.ensureVoiceWakePermissions(interactive: true)
                    guard granted else {
                        await self.setNativeSpeechState(listening: false, error: "Microphone or speech recognition access denied.")
                        return
                    }
                    await self.setNativeSpeechState(listening: true, error: nil)
                    await VoicePushToTalk.shared.begin()
                case "stop":
                    await VoicePushToTalk.shared.end()
                    await self.setNativeSpeechState(listening: false, error: nil)
                default:
                    break
                }
            }
            return
        }

        guard message.name == "argentNativeVoiceEvent" else { return }
        guard let body = message.body as? [String: Any] else { return }
        if let kind = body["kind"] as? String, kind == "tts_stop" {
            Task {
                await TalkModeRuntime.shared.stopSpeaking(reason: .manual)
            }
            return
        }
        guard
            let kind = body["kind"] as? String,
            let text = body["text"] as? String,
            let sessionKey = body["sessionKey"] as? String,
            let messageId = body["messageId"] as? String
        else { return }
        let event = DashboardNativeVoiceEvent(
            kind: kind,
            text: text,
            sessionKey: sessionKey,
            messageId: messageId,
            mood: body["mood"] as? String)
        Task {
            await TalkModeRuntime.shared.handleDashboardVoiceEvent(event)
        }
    }

    func webView(_ webView: WKWebView, didFinish _: WKNavigation!) {
        let js = """
        (() => {
          try {
            window.__argentNativeVoiceActive = true;
            window.__argentNativeSpeechActive = true;
            return true;
          } catch {
            return false;
          }
        })();
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func webView(
        _: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame _: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void)
    {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.resolvesAliases = true
        panel.canCreateDirectories = false

        panel.begin { response in
            guard response == .OK else {
                completionHandler(nil)
                return
            }
            completionHandler(panel.urls)
        }
    }

    func load(url: URL) {
        self.dashboardURL = url
        self.webView.load(URLRequest(url: url))
    }

    func activeSessionKey() async -> String? {
        await withCheckedContinuation { continuation in
            let js = """
            (() => {
              try {
                const live =
                  typeof window.__argentCurrentSessionKey === 'string'
                    ? window.__argentCurrentSessionKey.trim()
                    : '';
                if (live) return live;
                const raw = window.localStorage.getItem('argent-session-key');
                return (typeof raw === 'string' && raw.trim()) ? raw.trim() : null;
              } catch {
                return null;
              }
            })();
            """
            self.webView.evaluateJavaScript(js) { result, _ in
                let value = (result as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                continuation.resume(returning: value?.isEmpty == false ? value : nil)
            }
        }
    }

    func latestAssistantMessage(sessionKey: String, since: Double? = nil) async -> (text: String, spokenSummary: String?, timestamp: Double?)? {
        await withCheckedContinuation { continuation in
            let escapedSessionKey = sessionKey
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
            let sinceMs = since.map { Int($0 * 1000) } ?? 0
            let js = """
            (() => {
              try {
                const payload = window.__argentCurrentAssistantMessage;
                if (!payload || typeof payload !== 'object') return null;
                if (payload.sessionKey !== "\(escapedSessionKey)") return null;
                if (typeof payload.content !== 'string' || !payload.content.trim()) return null;
                const timestampMs = typeof payload.timestampMs === 'number' ? payload.timestampMs : null;
                if (timestampMs !== null && timestampMs < \(sinceMs)) return null;
                const ttsSummary =
                  typeof payload.ttsSummary === 'string' && payload.ttsSummary.trim()
                    ? payload.ttsSummary.trim()
                    : null;
                return { text: payload.content.trim(), ttsSummary, timestampMs };
              } catch {
                return null;
              }
            })();
            """
            self.webView.evaluateJavaScript(js) { result, _ in
                guard
                    let dict = result as? [String: Any],
                    let text = dict["text"] as? String,
                    !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                else {
                    continuation.resume(returning: nil)
                    return
                }
                let spokenSummary = (dict["ttsSummary"] as? String)?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                let timestampMs = dict["timestampMs"] as? Double
                continuation.resume(returning: (
                    text,
                    spokenSummary?.isEmpty == false ? spokenSummary : nil,
                    timestampMs.map { $0 / 1000.0 }
                ))
            }
        }
    }

    func attachTtsAudio(messageId: String, audioURL: String) async {
        guard !messageId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard !audioURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let js = """
        (() => {
          try {
            if (typeof window.__argentNativeAttachTtsAudio !== 'function') return false;
            window.__argentNativeAttachTtsAudio({ msgId, audioUrl });
            return true;
          } catch {
            return false;
          }
        })();
        """
        _ = try? await self.webView.callAsyncJavaScript(
            js,
            arguments: [
                "msgId": messageId,
                "audioUrl": audioURL,
            ],
            in: nil,
            in: .page
        )
    }

    func setNativeVoiceSpeaking(_ speaking: Bool) async {
        let js = """
        (() => {
          try {
            if (typeof window.__argentNativeVoiceStateChanged !== 'function') return false;
            window.__argentNativeVoiceStateChanged({ speaking });
            return true;
          } catch {
            return false;
          }
        })();
        """
        _ = try? await self.webView.callAsyncJavaScript(
            js,
            arguments: ["speaking": speaking],
            in: nil,
            in: .page
        )
    }

    func setNativeSpeechState(listening: Bool, error: String?) async {
        let js = """
        (() => {
          try {
            if (typeof window.__argentNativeSpeechStateChanged !== 'function') return false;
            window.__argentNativeSpeechStateChanged({ listening, error });
            return true;
          } catch {
            return false;
          }
        })();
        """
        _ = try? await self.webView.callAsyncJavaScript(
            js,
            arguments: [
                "listening": listening,
                "error": error as Any,
            ],
            in: nil,
            in: .page
        )
    }

    func sendMessage(_ content: String) async -> (ok: Bool, sessionKey: String?, error: String?) {
        await withCheckedContinuation { continuation in
            guard let data = try? JSONSerialization.data(withJSONObject: [content], options: []),
                  let json = String(data: data, encoding: .utf8)
            else {
                continuation.resume(returning: (false, nil, "encode-failed"))
                return
            }

            let js = """
            (() => {
              try {
                if (typeof window.__argentNativeSendMessage !== 'function') {
                  return { ok: false, error: 'native-send-unavailable' };
                }
                const result = window.__argentNativeSendMessage(...\(json));
                if (!result || typeof result !== 'object') {
                  return { ok: false, error: 'native-send-invalid-result' };
                }
                return result;
              } catch (error) {
                return { ok: false, error: String(error) };
              }
            })();
            """

            self.webView.evaluateJavaScript(js) { result, _ in
                guard let dict = result as? [String: Any] else {
                    continuation.resume(returning: (false, nil, "native-send-no-result"))
                    return
                }
                let ok = dict["ok"] as? Bool ?? false
                let sessionKey = (dict["sessionKey"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                let error = (dict["error"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                continuation.resume(returning: (ok, sessionKey?.isEmpty == false ? sessionKey : nil, error?.isEmpty == false ? error : nil))
            }
        }
    }

    func webView(
        _: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void)
    {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let scheme = (url.scheme ?? "").lowercased()

        // Keep local dashboard traffic inside the shell window.
        if Self.isDashboardURL(url, expected: self.dashboardURL) {
            decisionHandler(.allow)
            return
        }

        // Common internal WebKit navigations (about:blank/srcdoc, data/blob payloads, inline scripts)
        // must stay in-process. Sending these to NSWorkspace causes "no application to open URL" alerts.
        if scheme == "about" || scheme == "blob" || scheme == "data" || scheme == "javascript" {
            decisionHandler(.allow)
            return
        }

        // External links leave the app shell only when a handler exists.
        // This avoids macOS "no application set to open URL ..." alerts for odd schemes.
        if let appURL = NSWorkspace.shared.urlForApplication(toOpen: url) {
            NSWorkspace.shared.open(
                [url],
                withApplicationAt: appURL,
                configuration: NSWorkspace.OpenConfiguration(),
                completionHandler: nil)
        }
        decisionHandler(.cancel)
    }

    private static func isDashboardURL(_ candidate: URL, expected: URL) -> Bool {
        let scheme = (candidate.scheme ?? "").lowercased()
        guard scheme == "http" || scheme == "https" else { return false }
        let expectedHost = (expected.host ?? "").lowercased()
        let candidateHost = (candidate.host ?? "").lowercased()
        guard !expectedHost.isEmpty, expectedHost == candidateHost else { return false }
        return candidate.port == expected.port
    }

    @available(macOS 12.0, *)
    func webView(
        _: WKWebView,
        requestMediaCapturePermissionFor _: WKSecurityOrigin,
        initiatedByFrame _: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void)
    {
        Task { @MainActor in
            let caps: [Capability]
            switch type {
            case .camera:
                caps = [.camera]
            case .microphone:
                caps = [.microphone]
            case .cameraAndMicrophone:
                caps = [.camera, .microphone]
            @unknown default:
                decisionHandler(.deny)
                return
            }

            let results = await PermissionManager.ensure(caps, interactive: true)
            let granted = caps.allSatisfy { results[$0] == true }
            decisionHandler(granted ? .grant : .deny)
        }
    }
}

struct DashboardNativeVoiceEvent: Sendable {
    let kind: String
    let text: String
    let sessionKey: String
    let messageId: String
    let mood: String?
}
