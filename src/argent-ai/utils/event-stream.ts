/**
 * Event Stream Utility
 *
 * Provides an async iterable event stream with deferred result resolution.
 * Based on pi-ai's EventStream but with ArgentOS-specific enhancements.
 *
 * @module argent-ai/utils/event-stream
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
} from "../types.js";

/**
 * Generic event stream that supports async iteration and deferred result.
 */
export class EventStream<TEvent, TResult> implements AsyncIterable<TEvent> {
  private queue: TEvent[] = [];
  private waiting: ((value: IteratorResult<TEvent>) => void)[] = [];
  private ended = false;
  private resultPromise: Promise<TResult>;
  private resolveResult!: (value: TResult) => void;
  private rejectResult!: (reason: unknown) => void;
  private finalResult: TResult | undefined;
  private isCompleted: (event: TEvent) => boolean;
  private extractResult: (event: TEvent) => TResult;

  constructor(isCompleted: (event: TEvent) => boolean, extractResult: (event: TEvent) => TResult) {
    this.isCompleted = isCompleted;
    this.extractResult = extractResult;
    this.resultPromise = new Promise((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
  }

  /**
   * Push an event to the stream.
   */
  push(event: TEvent): void {
    if (this.ended) {
      throw new Error("Cannot push to ended stream");
    }

    // Check if this event completes the stream
    if (this.isCompleted(event)) {
      this.finalResult = this.extractResult(event);
    }

    // If someone is waiting, deliver directly
    if (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter({ value: event, done: false });
    } else {
      // Otherwise queue the event
      this.queue.push(event);
    }
  }

  /**
   * End the stream and resolve the result.
   */
  end(result?: TResult): void {
    if (this.ended) return;
    this.ended = true;

    const finalResult = result ?? this.finalResult;
    if (finalResult !== undefined) {
      this.resolveResult(finalResult);
    }

    // Signal done to any waiting consumers
    for (const waiter of this.waiting) {
      waiter({ value: undefined as unknown as TEvent, done: true });
    }
    this.waiting = [];
  }

  /**
   * End the stream with an error.
   */
  error(err: unknown): void {
    if (this.ended) return;
    this.ended = true;
    this.rejectResult(err);

    // Signal done to any waiting consumers
    for (const waiter of this.waiting) {
      waiter({ value: undefined as unknown as TEvent, done: true });
    }
    this.waiting = [];
  }

  /**
   * Get the final result after the stream completes.
   */
  result(): Promise<TResult> {
    return this.resultPromise;
  }

  /**
   * Async iterator implementation.
   */
  [Symbol.asyncIterator](): AsyncIterator<TEvent> {
    return {
      next: async (): Promise<IteratorResult<TEvent>> => {
        // Return queued events first
        if (this.queue.length > 0) {
          return { value: this.queue.shift()!, done: false };
        }

        // If ended, signal completion
        if (this.ended) {
          return { value: undefined as unknown as TEvent, done: true };
        }

        // Wait for next event
        return new Promise((resolve) => {
          this.waiting.push(resolve);
        });
      },
    };
  }
}

/**
 * Create an AssistantMessageEventStream.
 */
export function createAssistantMessageEventStream(): EventStream<
  AssistantMessageEvent,
  AssistantMessage
> &
  AssistantMessageEventStream {
  return new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === "done" || event.type === "error",
    (event) => {
      if (event.type === "done") {
        return event.message;
      }
      if (event.type === "error") {
        return event.error;
      }
      throw new Error("Unexpected event type");
    },
  );
}

/**
 * Type guard for done events.
 */
export function isDoneEvent(
  event: AssistantMessageEvent,
): event is Extract<AssistantMessageEvent, { type: "done" }> {
  return event.type === "done";
}

/**
 * Type guard for error events.
 */
export function isErrorEvent(
  event: AssistantMessageEvent,
): event is Extract<AssistantMessageEvent, { type: "error" }> {
  return event.type === "error";
}

/**
 * Type guard for text delta events.
 */
export function isTextDeltaEvent(
  event: AssistantMessageEvent,
): event is Extract<AssistantMessageEvent, { type: "text_delta" }> {
  return event.type === "text_delta";
}

/**
 * Type guard for thinking delta events.
 */
export function isThinkingDeltaEvent(
  event: AssistantMessageEvent,
): event is Extract<AssistantMessageEvent, { type: "thinking_delta" }> {
  return event.type === "thinking_delta";
}

/**
 * Type guard for toolcall end events.
 */
export function isToolCallEndEvent(
  event: AssistantMessageEvent,
): event is Extract<AssistantMessageEvent, { type: "toolcall_end" }> {
  return event.type === "toolcall_end";
}
