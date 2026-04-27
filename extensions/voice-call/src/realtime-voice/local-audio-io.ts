import type { RealtimeVoiceCloseReason } from "./provider-types.js";
import {
  createRealtimeVoiceOperatorSession,
  type RealtimeVoiceOperatorSession,
  type RealtimeVoiceOperatorSessionEvent,
  type RealtimeVoiceOperatorSessionParams,
} from "./operator-session.js";

export type RealtimeOperatorAudioInput = {
  readonly sourceLabel: string;
  start(onPcm24k: (chunk: Buffer) => void): void;
  stop(): void;
};

export type RealtimeOperatorAudioOutput = {
  readonly sinkLabel: string;
  writePcm24k(chunk: Buffer): void;
  clear(): void;
  close(): void;
};

export type RealtimeOperatorAudioSession = {
  readonly operatorSession: RealtimeVoiceOperatorSession;
  start(): Promise<void>;
  stop(reason?: RealtimeVoiceCloseReason): void;
  isConnected(): boolean;
};

export type RealtimeOperatorAudioSessionParams = RealtimeVoiceOperatorSessionParams & {
  audioInput: RealtimeOperatorAudioInput;
  audioOutput: RealtimeOperatorAudioOutput;
};

export class SyntheticRealtimeOperatorAudioInput implements RealtimeOperatorAudioInput {
  readonly sourceLabel = "synthetic-pcm24k";
  readonly frames: Buffer[];
  started = false;
  stopped = false;

  constructor(frames: Array<Buffer | number[] | string>) {
    this.frames = frames.map((frame) => {
      if (Buffer.isBuffer(frame)) {
        return Buffer.from(frame);
      }
      if (Array.isArray(frame)) {
        return Buffer.from(frame);
      }
      return Buffer.from(frame);
    });
  }

  start(onPcm24k: (chunk: Buffer) => void): void {
    if (this.stopped) {
      throw new Error("Synthetic realtime audio input is stopped");
    }
    this.started = true;
    for (const frame of this.frames) {
      if (this.stopped) {
        return;
      }
      onPcm24k(Buffer.from(frame));
    }
  }

  stop(): void {
    this.stopped = true;
  }
}

export class CaptureRealtimeOperatorAudioOutput implements RealtimeOperatorAudioOutput {
  readonly sinkLabel = "capture-pcm24k";
  readonly chunks: Buffer[] = [];
  clearCount = 0;
  closed = false;

  writePcm24k(chunk: Buffer): void {
    if (this.closed) {
      return;
    }
    this.chunks.push(Buffer.from(chunk));
  }

  clear(): void {
    if (this.closed) {
      return;
    }
    this.clearCount += 1;
    this.chunks.length = 0;
  }

  close(): void {
    this.closed = true;
  }
}

export function createRealtimeOperatorAudioSession({
  audioInput,
  audioOutput,
  onEvent,
  ...params
}: RealtimeOperatorAudioSessionParams): RealtimeOperatorAudioSession {
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    audioInput.stop();
    audioOutput.close();
  };

  const operatorSession = createRealtimeVoiceOperatorSession({
    ...params,
    onEvent: (event: RealtimeVoiceOperatorSessionEvent) => {
      if (event.type === "audio") {
        audioOutput.writePcm24k(event.audio);
      } else if (event.type === "clearAudio") {
        audioOutput.clear();
      } else if (event.type === "close" || event.type === "error") {
        cleanup();
      }
      onEvent?.(event);
    },
  });

  return {
    operatorSession,
    isConnected: () => operatorSession.isConnected(),
    start: async () => {
      try {
        await operatorSession.connect();
        if (cleanedUp) {
          return;
        }
        audioInput.start((chunk) => operatorSession.sendAudio(chunk));
      } catch (err) {
        cleanup();
        operatorSession.close("error");
        throw err;
      }
    },
    stop: (reason = "completed") => {
      cleanup();
      operatorSession.close(reason);
    },
  };
}
