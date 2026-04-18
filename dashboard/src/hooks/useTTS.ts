import { useCallback, useRef } from "react";
import type { AgentTtsProfile } from "../lib/agentVoiceProfiles";
import { voices, type Voice } from "../components/AudioDeviceSelector";
import { type MoodName, getMoodVoiceSettings, getMood } from "../lib/moodSystem";

interface UseTTSOptions {
  voice?: Voice;
  profile?: AgentTtsProfile | null;
  outputDeviceId?: string; // Audio output device ID
  /** Allow fallback to system/macOS voice when ElevenLabs fails (default: false) */
  allowWebSpeechFallback?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
  onAudioReady?: (audio: HTMLAudioElement) => void;
  onAnalyserReady?: (analyser: AnalyserNode) => void; // For lip sync
  /** Called when audio starts playing — text is the spoken content, durationMs is audio length */
  onSpeechStart?: (text: string, durationMs: number) => void;
  /** Called when audio finishes playing */
  onSpeechEnd?: () => void;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut && !parentSignal?.aborted) {
      throw Object.assign(new Error(`TTS request timed out after ${timeoutMs}ms`), {
        name: "TimeoutError",
        status: 504,
      });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
  }
}

function stripAudioTags(text: string): string {
  return text
    .replace(/\[(?:\/)?[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeTextForProvider(
  text: string,
  profile: AgentTtsProfile | null | undefined,
): string {
  if (profile?.provider === "fish") {
    return stripAudioTags(text);
  }
  return text;
}

export function useTTS(options: UseTTSOptions = {}) {
  const {
    voice = "jessica",
    profile = null,
    outputDeviceId,
    allowWebSpeechFallback = false,
    onStart,
    onEnd,
    onError,
    onAudioReady,
    onAnalyserReady,
    onSpeechStart,
    onSpeechEnd,
  } = options;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const webSpeechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  /** Web Speech API fallback — uses system voices (Apple TTS on macOS) */
  const speakWithWebSpeechAPI = useCallback(
    (text: string, startTime: number) => {
      // Strip ElevenLabs audio tags like [laughs], [whispers], etc.
      const cleanText = text.replace(/\[[^\]]*\]/g, "").trim();
      if (!cleanText) return;

      const utterance = new SpeechSynthesisUtterance(cleanText);
      webSpeechUtteranceRef.current = utterance;

      // Pick a good system voice — prefer Samantha (macOS) or a female en-US voice
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) => v.name.includes("Samantha") || v.name.includes("Zoe") || v.name.includes("Karen"),
      );
      const englishFallback = voices.find((v) => v.lang.startsWith("en") && v.localService);
      if (preferred) utterance.voice = preferred;
      else if (englishFallback) utterance.voice = englishFallback;

      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      const durationMs = cleanText.length * 65; // rough estimate

      utterance.onstart = () => {
        console.log(
          "[TTS] Web Speech playing, time-to-audio:",
          Math.round(performance.now() - startTime),
          "ms",
        );
        onStart?.();
        onSpeechStart?.(cleanText, durationMs);
      };

      utterance.onend = () => {
        webSpeechUtteranceRef.current = null;
        onSpeechEnd?.();
        onEnd?.();
      };

      utterance.onerror = (ev) => {
        webSpeechUtteranceRef.current = null;
        if (ev.error === "canceled" || ev.error === "interrupted") return;
        console.error("[TTS] Web Speech error:", ev.error);
        onError?.(new Error(`Web Speech failed: ${ev.error}`));
      };

      window.speechSynthesis.speak(utterance);
    },
    [onStart, onEnd, onError, onSpeechStart, onSpeechEnd],
  );

  const speak = useCallback(
    async (text: string, mood?: MoodName) => {
      console.log(
        "[TTS] speak() called with:",
        text?.substring(0, 100),
        "mood:",
        mood ?? "neutral",
      );
      console.log("[TTS] Output device ID:", outputDeviceId);
      if (!text.trim()) return;

      // Cancel any ongoing speech
      stop();

      const provider = profile?.provider ?? "elevenlabs";
      const ttsText = sanitizeTextForProvider(text, profile);
      if (!ttsText.trim()) return;

      // Per-mood voice preset overrides the user-selected voice for ElevenLabs only.
      const moodConfig = getMood(mood ?? "neutral");
      const voiceId =
        provider === "elevenlabs"
          ? profile?.voiceId || moodConfig.voicePreset || voices[voice]?.id || voices.jessica.id
          : (profile?.voiceId ?? "");
      abortControllerRef.current = new AbortController();

      // Get mood-aware voice settings
      const moodVoice = getMoodVoiceSettings(mood ?? "neutral");

      try {
        onStart?.();
        const ttsStart = performance.now();

        let response: Response | null = null;
        let responseEndpoint = "";
        let modelId = profile?.modelId ?? "eleven_v3";
        let lastStatus = 0;
        let lastErr: unknown = null;

        const directApiEndpoint = `http://${window.location.hostname}:9242/api/proxy/tts/${provider}`;
        const endpointPath = `/api/proxy/tts/${provider}`;
        const endpoints = import.meta.env.DEV ? [directApiEndpoint, endpointPath] : [endpointPath];

        if (provider === "fish") {
          for (const endpoint of endpoints) {
            try {
              console.log(`[TTS] Requesting fish via ${endpoint}`);
              const res = await fetchWithTimeout(
                endpoint,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Accept: "audio/mpeg",
                  },
                  cache: "no-store",
                  body: JSON.stringify({
                    reference_id: voiceId,
                    text: ttsText,
                    format: profile?.outputFormat || "mp3",
                  }),
                },
                15000,
                abortControllerRef.current.signal,
              );

              if (res.ok) {
                response = res;
                responseEndpoint = endpoint;
                break;
              }

              lastStatus = res.status;
              const errorText = await res.text().catch(() => "");
              lastErr = errorText;
              console.warn(`[TTS] fish via ${endpoint} failed (${res.status})`, errorText);
            } catch (err) {
              if (err instanceof Error && err.name === "AbortError") {
                throw err;
              }
              lastErr = err;
              console.warn("[TTS] fish request error", err);
            }
          }
        } else {
          // Always use eleven_v3 for full emotional range; fall back to turbo if v3 fails.
          const models = [profile?.modelId || "eleven_v3", "eleven_turbo_v2_5"] as const;
          outer: for (const model of models) {
            modelId = model;

            // v3 only accepts stability: 0.0 | 0.5 | 1.0 — snap to nearest valid value
            const stability =
              model === "eleven_v3"
                ? moodVoice.stability <= 0.25
                  ? 0.0
                  : moodVoice.stability >= 0.75
                    ? 1.0
                    : 0.5
                : moodVoice.stability;

            for (const endpoint of endpoints) {
              try {
                console.log(`[TTS] Requesting ${model} via ${endpoint}`);
                const res = await fetchWithTimeout(
                  endpoint,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Accept: "audio/mpeg",
                    },
                    cache: "no-store",
                    body: JSON.stringify({
                      voiceId,
                      outputFormat: "mp3_44100_128",
                      text: ttsText,
                      model_id: model,
                      voice_settings: {
                        stability,
                        similarity_boost: moodVoice.similarityBoost,
                        style: moodVoice.style,
                        speed: moodVoice.speed,
                        use_speaker_boost: true,
                      },
                    }),
                  },
                  15000,
                  abortControllerRef.current.signal,
                );

                if (res.ok) {
                  response = res;
                  responseEndpoint = endpoint;
                  break outer;
                }

                lastStatus = res.status;
                const errorText = await res.text().catch(() => "");
                lastErr = errorText;
                console.warn(`[TTS] ${model} via ${endpoint} failed (${res.status})`, errorText);
              } catch (err) {
                if (err instanceof Error && err.name === "AbortError") {
                  throw err;
                }
                lastErr = err;
                console.warn(`[TTS] ${model} via ${endpoint} request error`, err);
              }
            }
          }
        }

        if (!response) {
          // ElevenLabs unavailable — optional fallback to Web Speech API
          if (allowWebSpeechFallback && "speechSynthesis" in window) {
            console.log("[TTS] ElevenLabs unavailable, falling back to Web Speech API");
            speakWithWebSpeechAPI(text, ttsStart);
            return;
          }
          const baseError =
            lastErr instanceof Error
              ? lastErr.message
              : typeof lastErr === "string"
                ? lastErr
                : "unknown error";
          throw Object.assign(new Error(`TTS failed on all models: ${baseError}`), {
            status: lastStatus || ((lastErr as any)?.status ?? 502),
          });
        }

        const ttfbMs = Math.round(performance.now() - ttsStart);
        const contentType = response.headers.get("content-type") || "";
        console.log(
          "[TTS] Response headers in",
          ttfbMs,
          "ms, model:",
          modelId,
          "endpoint:",
          responseEndpoint,
          "content-type:",
          contentType,
        );

        // Guard: if the response isn't audio, check by content-type header
        if (!contentType.includes("audio")) {
          const errorText = await response.text().catch(() => "");
          console.error(`[TTS] Non-audio response from ${provider}:`, errorText);
          if (allowWebSpeechFallback && "speechSynthesis" in window) {
            console.log("[TTS] Non-audio response, falling back to Web Speech API");
            speakWithWebSpeechAPI(ttsText, ttsStart);
            return;
          }
          throw Object.assign(new Error(`TTS returned non-audio: ${contentType}`), { status: 502 });
        }

        // Stream audio using MediaSource API for lowest time-to-audio.
        // Falls back to full-blob buffering if MediaSource doesn't support audio/mpeg.
        const useMediaSource =
          typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg");

        if (useMediaSource && response.body) {
          console.log("[TTS] Using MediaSource streaming playback");
          const mediaSource = new MediaSource();
          const blobUrl = URL.createObjectURL(mediaSource);
          const audio = new Audio(blobUrl);
          audioRef.current = audio;

          // Set output device
          if (outputDeviceId && "setSinkId" in audio) {
            try {
              await (audio as any).setSinkId(outputDeviceId);
            } catch (err) {
              console.warn("[TTS] Failed to set Audio sinkId:", err);
            }
          }

          // Create AudioContext + analyser for lip sync
          const audioCtx = new AudioContext();
          audioCtxRef.current = audioCtx;
          const sourceNode = audioCtx.createMediaElementSource(audio);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.5;
          sourceNode.connect(analyser);
          analyser.connect(audioCtx.destination);
          if (audioCtx.state === "suspended") {
            try {
              await audioCtx.resume();
            } catch {}
          }
          onAnalyserReady?.(analyser);
          onAudioReady?.(audio);

          audio.onended = () => {
            audioCtxRef.current = null;
            audioCtx.close();
            onSpeechEnd?.();
            onEnd?.();
          };

          // Pipe response stream into MediaSource SourceBuffer
          await new Promise<void>((resolve, reject) => {
            let totalBytes = 0;
            let playStarted = false;

            mediaSource.addEventListener(
              "sourceopen",
              async () => {
                const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
                const reader = response.body!.getReader();
                const pendingChunks: Uint8Array[] = [];
                let streamDone = false;

                const flushPending = () => {
                  if (sourceBuffer.updating || pendingChunks.length === 0) return;
                  const chunk = pendingChunks.shift()!;
                  // Force conversion to a clean ArrayBuffer to satisfy BufferSource type
                  const cleanBuffer = new Uint8Array(chunk).buffer;
                  sourceBuffer.appendBuffer(cleanBuffer);
                };

                sourceBuffer.addEventListener("updateend", () => {
                  // Start playback as soon as we have some buffered data
                  if (!playStarted && audio.buffered.length > 0) {
                    playStarted = true;
                    const playMs = Math.round(performance.now() - ttsStart);
                    console.log(
                      "[TTS] Streaming playback starting, time-to-audio:",
                      playMs,
                      "ms, buffered:",
                      totalBytes,
                      "bytes",
                    );
                    const durationMs = ttsText.length * 60; // estimate; real duration unknown until stream ends
                    onSpeechStart?.(ttsText, durationMs);
                    audio.play().catch((e) => {
                      if (e.name !== "AbortError") reject(e);
                    });
                  }
                  if (streamDone && pendingChunks.length === 0) {
                    try {
                      mediaSource.endOfStream();
                    } catch {}
                    const totalMs = Math.round(performance.now() - ttsStart);
                    console.log("[TTS] Stream complete:", totalBytes, "bytes in", totalMs, "ms");
                    resolve();
                    return;
                  }
                  flushPending();
                });

                try {
                  while (true) {
                    const { done: readerDone, value } = await reader.read();
                    if (readerDone) {
                      streamDone = true;
                      // If nothing is pending/updating, finalize now
                      if (!sourceBuffer.updating && pendingChunks.length === 0) {
                        try {
                          mediaSource.endOfStream();
                        } catch {}
                        const totalMs = Math.round(performance.now() - ttsStart);
                        console.log(
                          "[TTS] Stream complete:",
                          totalBytes,
                          "bytes in",
                          totalMs,
                          "ms",
                        );
                        resolve();
                      }
                      break;
                    }
                    totalBytes += value.length;
                    pendingChunks.push(value);
                    flushPending();
                  }
                } catch (err) {
                  reject(err);
                }
              },
              { once: true },
            );
          });
        } else {
          // Fallback: buffer entire response then play
          console.log("[TTS] Using blob fallback (MediaSource not available for audio/mpeg)");
          const audioBlob = await response.blob();
          const blobMs = Math.round(performance.now() - ttsStart);
          console.log(
            "[TTS] Got audio blob:",
            audioBlob.size,
            "bytes in",
            blobMs,
            "ms (TTFB:",
            ttfbMs,
            "ms, download:",
            blobMs - ttfbMs,
            "ms)",
          );
          const blobUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(blobUrl);
          audioRef.current = audio;

          if (outputDeviceId && "setSinkId" in audio) {
            try {
              await (audio as any).setSinkId(outputDeviceId);
            } catch (err) {
              console.warn("[TTS] Failed to set Audio sinkId:", err);
            }
          }

          const audioCtx = new AudioContext();
          audioCtxRef.current = audioCtx;
          const sourceNode = audioCtx.createMediaElementSource(audio);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.5;
          sourceNode.connect(analyser);
          analyser.connect(audioCtx.destination);
          if (audioCtx.state === "suspended") {
            try {
              await audioCtx.resume();
            } catch {}
          }
          onAnalyserReady?.(analyser);
          onAudioReady?.(audio);

          audio.onended = () => {
            audioCtxRef.current = null;
            audioCtx.close();
            onSpeechEnd?.();
            onEnd?.();
          };

          console.log(
            "[TTS] Playing (blob), time-to-audio:",
            Math.round(performance.now() - ttsStart),
            "ms",
          );
          const durationMs =
            audio.duration && isFinite(audio.duration)
              ? audio.duration * 1000
              : ttsText.length * 60;
          onSpeechStart?.(ttsText, durationMs);
          await audio.play();
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Cancelled, not an error
          return;
        }
        // Last resort fallback is optional
        if (allowWebSpeechFallback && "speechSynthesis" in window) {
          console.warn(`[TTS] ${provider} error, falling back to Web Speech API:`, err);
          speakWithWebSpeechAPI(ttsText, performance.now());
          return;
        }
        console.error("[TTS] Error:", err);
        const normalized =
          err instanceof Error
            ? err
            : Object.assign(new Error("TTS failed"), {
                status: (err as any)?.status,
              });
        onError?.(normalized);
      }
    },
    [
      voice,
      profile,
      outputDeviceId,
      allowWebSpeechFallback,
      onStart,
      onEnd,
      onError,
      onAudioReady,
      onAnalyserReady,
      onSpeechStart,
      onSpeechEnd,
      speakWithWebSpeechAPI,
    ],
  );

  const stop = useCallback(() => {
    // Abort any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Cancel Web Speech API utterance
    if (webSpeechUtteranceRef.current) {
      window.speechSynthesis.cancel();
      webSpeechUtteranceRef.current = null;
    }

    // Stop Audio element
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch {}
      audioRef.current = null;
    }

    // Stop AudioContext source (legacy/playUrl path)
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {}
      sourceRef.current = null;
    }

    // Close AudioContext
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  }, []);

  // Play audio from a URL (for pre-generated TTS like MEDIA: paths)
  const playUrl = useCallback(
    async (url: string) => {
      console.log("[TTS] playUrl() called with:", url);

      // Cancel any ongoing speech
      stop();

      try {
        onStart?.();

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch audio: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;

        // Set output device
        if (outputDeviceId && "setSinkId" in audioCtx) {
          try {
            await (audioCtx as any).setSinkId(outputDeviceId);
          } catch (err) {
            console.warn("[TTS] Failed to set AudioContext sinkId:", err);
          }
        }

        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        console.log("[TTS] MEDIA audio decoded:", audioBuffer.duration, "seconds");

        const source = audioCtx.createBufferSource();
        sourceRef.current = source;
        source.buffer = audioBuffer;

        // Create analyser for lip sync
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;

        source.connect(analyser);
        analyser.connect(audioCtx.destination);

        if (audioCtx.state === "suspended") {
          try {
            await audioCtx.resume();
          } catch {}
        }

        onAnalyserReady?.(analyser);

        const dummyAudio = new Audio();
        dummyAudio.src = url;
        audioRef.current = dummyAudio;
        onAudioReady?.(dummyAudio);

        source.onended = () => {
          audioCtxRef.current = null;
          sourceRef.current = null;
          audioCtx.close();
          onSpeechEnd?.();
          onEnd?.();
        };

        // Fire speech start for playUrl path (no text available, use duration)
        onSpeechStart?.("", audioBuffer.duration * 1000);

        source.start();
        console.log("[TTS] MEDIA audio playing!");
      } catch (err) {
        console.error("[TTS] playUrl error:", err);
        onError?.(err instanceof Error ? err : new Error("Media playback failed"));
      }
    },
    [
      outputDeviceId,
      onStart,
      onEnd,
      onError,
      onAudioReady,
      onAnalyserReady,
      onSpeechStart,
      onSpeechEnd,
      stop,
    ],
  );

  const isSpeaking = useCallback(() => {
    // Check Web Speech API
    if (webSpeechUtteranceRef.current && window.speechSynthesis.speaking) return true;
    // Check Audio element first (primary path), then AudioContext (playUrl path)
    if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) return true;
    return audioCtxRef.current !== null && audioCtxRef.current.state === "running";
  }, []);

  return { speak, playUrl, stop, isSpeaking, audioRef };
}
