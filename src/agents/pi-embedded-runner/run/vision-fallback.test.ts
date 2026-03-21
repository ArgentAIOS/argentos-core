import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../minimax-vlm.js", () => ({
  minimaxUnderstandImage: vi.fn(),
  resolveMinimaxApiKey: vi.fn(),
}));

import { minimaxUnderstandImage, resolveMinimaxApiKey } from "../../minimax-vlm.js";
import { applyVisionFallbackToMessages, messagesHaveInlineImages } from "./vision-fallback.js";

type Message = {
  role: string;
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
};

const ORIGINAL_MAX_IMAGES = process.env.ARGENT_VISION_FALLBACK_MAX_IMAGES;
const ORIGINAL_BUDGET_MS = process.env.ARGENT_VISION_FALLBACK_BUDGET_MS;
const ORIGINAL_TIMEOUT_MS = process.env.ARGENT_VISION_FALLBACK_TIMEOUT_MS;

function resetVisionFallbackEnv(): void {
  delete process.env.ARGENT_VISION_FALLBACK_MAX_IMAGES;
  delete process.env.ARGENT_VISION_FALLBACK_BUDGET_MS;
  delete process.env.ARGENT_VISION_FALLBACK_TIMEOUT_MS;
}

function restoreVisionFallbackEnv(): void {
  if (ORIGINAL_MAX_IMAGES == null) {
    delete process.env.ARGENT_VISION_FALLBACK_MAX_IMAGES;
  } else {
    process.env.ARGENT_VISION_FALLBACK_MAX_IMAGES = ORIGINAL_MAX_IMAGES;
  }
  if (ORIGINAL_BUDGET_MS == null) {
    delete process.env.ARGENT_VISION_FALLBACK_BUDGET_MS;
  } else {
    process.env.ARGENT_VISION_FALLBACK_BUDGET_MS = ORIGINAL_BUDGET_MS;
  }
  if (ORIGINAL_TIMEOUT_MS == null) {
    delete process.env.ARGENT_VISION_FALLBACK_TIMEOUT_MS;
  } else {
    process.env.ARGENT_VISION_FALLBACK_TIMEOUT_MS = ORIGINAL_TIMEOUT_MS;
  }
}

describe("vision fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetVisionFallbackEnv();
  });

  afterEach(() => {
    restoreVisionFallbackEnv();
  });

  it("strips inline images when no MiniMax key is available", async () => {
    vi.mocked(resolveMinimaxApiKey).mockReturnValue(undefined);

    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "check this" },
          { type: "image", data: "Zm9v", mimeType: "image/png" },
        ],
      },
    ];

    const result = await applyVisionFallbackToMessages(messages, {
      modelHasVision: false,
    });

    const first = result[0];
    if (!first) throw new Error("missing result");
    expect(messagesHaveInlineImages(result as unknown[])).toBe(false);
    expect(first.content.some((b) => b.type === "image")).toBe(false);
    expect(first.content.some((b) => (b.text ?? "").includes("vision not available"))).toBe(true);
    expect(minimaxUnderstandImage).not.toHaveBeenCalled();
  });

  it("applies image count guardrail to avoid long pre-prompt stalls", async () => {
    process.env.ARGENT_VISION_FALLBACK_MAX_IMAGES = "1";
    process.env.ARGENT_VISION_FALLBACK_BUDGET_MS = "120000";
    vi.mocked(resolveMinimaxApiKey).mockReturnValue("test-key");
    vi.mocked(minimaxUnderstandImage).mockResolvedValue("a screenshot of a dashboard");

    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "image", data: "Zm9v", mimeType: "image/png" },
          { type: "image", data: "YmFy", mimeType: "image/png" },
        ],
      },
    ];

    const result = await applyVisionFallbackToMessages(messages, {
      modelHasVision: false,
    });

    expect(minimaxUnderstandImage).toHaveBeenCalledTimes(1);
    const first = result[0];
    if (!first) throw new Error("missing result");
    const texts = first.content.filter((b) => b.type === "text").map((b) => b.text ?? "");
    expect(texts.some((text) => text.includes("[Image:"))).toBe(true);
    expect(texts.some((text) => text.includes("skipped to keep response fast"))).toBe(true);
  });

  it("passes configured timeout through to MiniMax VLM requests", async () => {
    process.env.ARGENT_VISION_FALLBACK_TIMEOUT_MS = "1234";
    vi.mocked(resolveMinimaxApiKey).mockReturnValue("test-key");
    vi.mocked(minimaxUnderstandImage).mockResolvedValue("a screenshot");

    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "image", data: "Zm9v", mimeType: "image/png" }],
      },
    ];

    await applyVisionFallbackToMessages(messages, { modelHasVision: false });

    expect(minimaxUnderstandImage).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 1234,
      }),
    );
  });
});
