import { useState, useCallback, useRef, useEffect } from "react";

export type RecognitionMode = "browser" | "whisper";

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || "";

interface UseSpeechRecognitionOptions {
  mode?: RecognitionMode;
  deviceId?: string; // Audio input device ID
  onResult?: (transcript: string) => void;
  onInterim?: (transcript: string) => void;
  onError?: (error: Error) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const { mode = "browser", deviceId, onResult, onInterim, onError, onStart, onEnd } = options;

  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);

  // Ref to track listening state without stale closure issues
  const isListeningRef = useRef(false);

  // Store callbacks in refs to avoid re-creating MediaRecorder on every render
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);
  const onErrorRef = useRef(onError);
  const onStartRef = useRef(onStart);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onResultRef.current = onResult;
    onInterimRef.current = onInterim;
    onErrorRef.current = onError;
    onStartRef.current = onStart;
    onEndRef.current = onEnd;
  }, [onResult, onInterim, onError, onStart, onEnd]);

  // Browser speech recognition
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Whisper recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Check browser support
  useEffect(() => {
    if (mode === "browser") {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      setIsSupported(!!SpeechRecognition);
    } else {
      // Whisper mode - check for MediaRecorder
      setIsSupported(!!navigator.mediaDevices?.getUserMedia);
    }
  }, [mode]);

  // Browser Speech Recognition
  const startBrowserRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const err = new Error("Speech recognition not supported in this browser");
      setLastError(err.message);
      onErrorRef.current?.(err);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      isListeningRef.current = true;
      setIsListening(true);
      setLastError(null);
      onStartRef.current?.();
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);
      onEndRef.current?.();
      recognitionRef.current = null;
    };

    recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript) {
        onInterimRef.current?.(interimTranscript);
      }
      if (finalTranscript) {
        onResultRef.current?.(finalTranscript);
      }
    };

    recognition.onerror = (event) => {
      isListeningRef.current = false;
      setIsListening(false);
      if (event.error !== "no-speech" && event.error !== "aborted") {
        const msg =
          event.error === "not-allowed"
            ? "Microphone access denied. Please allow microphone access in your browser settings."
            : `Speech recognition error: ${event.error}`;
        setLastError(msg);
        onErrorRef.current?.(new Error(msg));
      }
      onEndRef.current?.();
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  // Pick a supported MIME type for MediaRecorder
  const getSupportedMimeType = useCallback((): string | undefined => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return undefined; // Let browser pick default
  }, []);

  // Whisper Recording
  const startWhisperRecording = useCallback(async () => {
    if (!OPENAI_API_KEY) {
      const err = new Error("No OpenAI API key configured. Set VITE_OPENAI_API_KEY in .env");
      setLastError(err.message);
      onErrorRef.current?.(err);
      return;
    }

    try {
      const audioConstraints = deviceId ? { deviceId: { exact: deviceId } } : {};
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints as MediaTrackConstraints,
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = getSupportedMimeType();
      const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(stream, recorderOptions);
      const actualMime = mediaRecorder.mimeType; // What the browser actually chose
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        if (chunksRef.current.length === 0) {
          onEndRef.current?.();
          return;
        }

        // Determine file extension from MIME type
        const ext = actualMime.includes("mp4")
          ? "mp4"
          : actualMime.includes("ogg")
            ? "ogg"
            : "webm";

        // Send to Whisper
        const audioBlob = new Blob(chunksRef.current, { type: actualMime });
        chunksRef.current = [];

        setIsProcessing(true);
        try {
          const formData = new FormData();
          formData.append("file", audioBlob, `audio.${ext}`);
          formData.append("model", "whisper-1");
          formData.append("language", "en");

          const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: formData,
          });

          if (!response.ok) {
            const statusText =
              response.status === 401
                ? "Whisper API failed: Invalid API key (401)"
                : `Whisper API error: ${response.status}`;
            throw new Error(statusText);
          }

          const data = await response.json();
          if (data.text) {
            onResultRef.current?.(data.text);
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error("Whisper transcription failed");
          setLastError(error.message);
          onErrorRef.current?.(error);
        }

        setIsProcessing(false);
        isListeningRef.current = false;
        setIsListening(false);
        onEndRef.current?.();
      };

      mediaRecorder.onerror = () => {
        const err = new Error("MediaRecorder error — microphone may have disconnected");
        setLastError(err.message);
        isListeningRef.current = false;
        setIsListening(false);
        onErrorRef.current?.(err);
        onEndRef.current?.();
      };

      mediaRecorder.start();
      isListeningRef.current = true;
      setIsListening(true);
      setLastError(null);
      onStartRef.current?.();
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to access microphone");
      const msg =
        error.message.includes("Permission denied") || error.message.includes("NotAllowedError")
          ? "Microphone access denied. Please allow microphone access in your browser settings."
          : error.message;
      setLastError(msg);
      onErrorRef.current?.(new Error(msg));
    }
  }, [deviceId, getSupportedMimeType]);

  // Start listening — uses ref to avoid stale closure on isListening state
  const start = useCallback(() => {
    if (isListeningRef.current) return;

    if (mode === "browser") {
      startBrowserRecognition();
    } else {
      startWhisperRecording();
    }
  }, [mode, startBrowserRecognition, startWhisperRecording]);

  // Stop listening
  const stop = useCallback(() => {
    if (mode === "browser" && recognitionRef.current) {
      recognitionRef.current.stop();
    } else if (mode === "whisper" && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
  }, [mode]);

  // Toggle listening
  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    isListening,
    isProcessing,
    isSupported,
    lastError,
    start,
    stop,
    toggle,
  };
}
