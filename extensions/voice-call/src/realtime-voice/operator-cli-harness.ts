import type { RealtimeVoiceCloseReason, RealtimeVoiceToolCallEvent } from "./provider-types.js";
import {
  createRealtimeVoiceOperatorSession,
  type RealtimeVoiceOperatorSession,
  type RealtimeVoiceOperatorSessionEvent,
  type RealtimeVoiceOperatorSessionParams,
} from "./operator-session.js";

export type RealtimeVoiceOperatorHarnessCommand =
  | { type: "connect" }
  | { type: "text"; text: string }
  | { type: "audioToken"; token: string | number[] | Buffer }
  | { type: "mediaTimestamp"; timestamp: number }
  | { type: "greeting"; instructions?: string }
  | { type: "toolResult"; callId: string; result: unknown }
  | { type: "ackMark" }
  | { type: "cancel" }
  | { type: "close"; reason?: RealtimeVoiceCloseReason };

export type RealtimeVoiceOperatorHarnessLogEntry =
  | {
      source: "operator";
      command:
        | { type: "connect" }
        | { type: "text"; text: string }
        | { type: "audioToken"; token: string }
        | { type: "mediaTimestamp"; timestamp: number }
        | { type: "greeting"; instructions?: string }
        | { type: "toolResult"; callId: string; result: unknown }
        | { type: "ackMark" }
        | { type: "cancel" }
        | { type: "close"; reason?: RealtimeVoiceCloseReason };
    }
  | { source: "session"; event: RealtimeVoiceOperatorHarnessSessionEvent };

export type RealtimeVoiceOperatorHarnessSessionEvent =
  | { type: "ready"; providerId: string }
  | { type: "audio"; base64: string }
  | { type: "clearAudio" }
  | { type: "mark"; markName: string }
  | { type: "transcript"; role: "user" | "assistant"; text: string; isFinal: boolean }
  | { type: "toolCall"; event: RealtimeVoiceToolCallEvent }
  | { type: "toolResult"; callId: string; result: unknown }
  | { type: "error"; message: string }
  | { type: "close"; reason: RealtimeVoiceCloseReason };

export type RealtimeVoiceOperatorCliHarness = {
  readonly session: RealtimeVoiceOperatorSession;
  dispatch(command: RealtimeVoiceOperatorHarnessCommand): Promise<void>;
  run(commands: RealtimeVoiceOperatorHarnessCommand[]): Promise<void>;
  getLog(): RealtimeVoiceOperatorHarnessLogEntry[];
  isClosed(): boolean;
};

export type RealtimeVoiceOperatorCliHarnessParams = RealtimeVoiceOperatorSessionParams & {
  onLog?: (entry: RealtimeVoiceOperatorHarnessLogEntry) => void;
};

function audioTokenToBuffer(token: string | number[] | Buffer): Buffer {
  if (Buffer.isBuffer(token)) {
    return Buffer.from(token);
  }
  if (Array.isArray(token)) {
    return Buffer.from(token);
  }
  return Buffer.from(token);
}

function audioTokenToLogToken(token: string | number[] | Buffer): string {
  if (Buffer.isBuffer(token)) {
    return token.toString("base64");
  }
  if (Array.isArray(token)) {
    return Buffer.from(token).toString("base64");
  }
  return token;
}

function cloneStable<T>(value: T): T {
  return structuredClone(value);
}

function normalizeSessionEvent(
  event: RealtimeVoiceOperatorSessionEvent,
): RealtimeVoiceOperatorHarnessSessionEvent {
  switch (event.type) {
    case "ready":
      return { type: "ready", providerId: event.providerId };
    case "audio":
      return { type: "audio", base64: event.audio.toString("base64") };
    case "clearAudio":
      return { type: "clearAudio" };
    case "mark":
      return { type: "mark", markName: event.markName };
    case "transcript":
      return {
        type: "transcript",
        role: event.role,
        text: event.text,
        isFinal: event.isFinal,
      };
    case "toolCall":
      return { type: "toolCall", event: cloneStable(event.event) };
    case "toolResult":
      return { type: "toolResult", callId: event.callId, result: cloneStable(event.result) };
    case "error":
      return { type: "error", message: event.error.message };
    case "close":
      return { type: "close", reason: event.reason };
  }
}

function normalizeOperatorCommand(
  command: RealtimeVoiceOperatorHarnessCommand,
): RealtimeVoiceOperatorHarnessLogEntry & { source: "operator" } {
  switch (command.type) {
    case "connect":
      return { source: "operator", command: { type: "connect" } };
    case "text":
      return { source: "operator", command: { type: "text", text: command.text } };
    case "audioToken":
      return {
        source: "operator",
        command: { type: "audioToken", token: audioTokenToLogToken(command.token) },
      };
    case "mediaTimestamp":
      return {
        source: "operator",
        command: { type: "mediaTimestamp", timestamp: command.timestamp },
      };
    case "greeting":
      return {
        source: "operator",
        command: { type: "greeting", instructions: command.instructions },
      };
    case "toolResult":
      return {
        source: "operator",
        command: {
          type: "toolResult",
          callId: command.callId,
          result: cloneStable(command.result),
        },
      };
    case "ackMark":
      return { source: "operator", command: { type: "ackMark" } };
    case "cancel":
      return { source: "operator", command: { type: "cancel" } };
    case "close":
      return { source: "operator", command: { type: "close", reason: command.reason } };
  }
}

export function createRealtimeVoiceOperatorCliHarness(
  params: RealtimeVoiceOperatorCliHarnessParams,
): RealtimeVoiceOperatorCliHarness {
  const log: RealtimeVoiceOperatorHarnessLogEntry[] = [];
  let closed = false;
  const record = (entry: RealtimeVoiceOperatorHarnessLogEntry) => {
    const stableEntry = cloneStable(entry);
    log.push(stableEntry);
    params.onLog?.(cloneStable(stableEntry));
  };
  const session = createRealtimeVoiceOperatorSession({
    ...params,
    onEvent: (event) => {
      record({ source: "session", event: normalizeSessionEvent(event) });
      params.onEvent?.(event);
    },
  });

  const dispatch = async (command: RealtimeVoiceOperatorHarnessCommand) => {
    if (closed) {
      throw new Error("Realtime voice operator CLI harness is closed");
    }
    record(normalizeOperatorCommand(command));
    switch (command.type) {
      case "connect":
        await session.connect();
        return;
      case "text":
        session.sendUserMessage(command.text);
        return;
      case "audioToken":
        session.sendAudio(audioTokenToBuffer(command.token));
        return;
      case "mediaTimestamp":
        session.setMediaTimestamp(command.timestamp);
        return;
      case "greeting":
        session.triggerGreeting(command.instructions);
        return;
      case "toolResult":
        session.submitToolResult(command.callId, command.result);
        return;
      case "ackMark":
        session.acknowledgeMark();
        return;
      case "cancel":
        closed = true;
        session.cancel();
        return;
      case "close":
        closed = true;
        session.close(command.reason);
        return;
    }
  };

  return {
    session,
    dispatch,
    getLog: () => cloneStable(log),
    isClosed: () => closed,
    run: async (commands) => {
      for (const command of commands) {
        await dispatch(command);
      }
    },
  };
}
