import { describe, expect, it } from "vitest";
import {
  AUDIO_PREPROCESS_PROMPT,
  DOCUMENT_PREPROCESS_PROMPT,
  IMAGE_PREPROCESS_PROMPT,
  VIDEO_PREPROCESS_PROMPT,
  PREPROCESS_PROMPTS,
  buildAudioPreprocessPrompt,
  buildDocumentPreprocessPrompt,
  buildImagePreprocessPrompt,
  buildVideoPreprocessPrompt,
} from "./preprocess.js";

describe("multimodal preprocess prompts (#311)", () => {
  it("exposes the four modality constants as non-empty strings naming their modality", () => {
    expect(AUDIO_PREPROCESS_PROMPT.length).toBeGreaterThan(0);
    expect(AUDIO_PREPROCESS_PROMPT).toMatch(/audio/i);
    expect(DOCUMENT_PREPROCESS_PROMPT.length).toBeGreaterThan(0);
    expect(DOCUMENT_PREPROCESS_PROMPT).toMatch(/document/i);
    expect(IMAGE_PREPROCESS_PROMPT.length).toBeGreaterThan(0);
    expect(IMAGE_PREPROCESS_PROMPT).toMatch(/image/i);
    expect(VIDEO_PREPROCESS_PROMPT.length).toBeGreaterThan(0);
    expect(VIDEO_PREPROCESS_PROMPT).toMatch(/video/i);
  });

  it("indexes the four prompts by modality key", () => {
    expect(Object.keys(PREPROCESS_PROMPTS).toSorted()).toEqual([
      "audio",
      "document",
      "image",
      "video",
    ]);
    expect(PREPROCESS_PROMPTS.audio).toBe(AUDIO_PREPROCESS_PROMPT);
    expect(PREPROCESS_PROMPTS.document).toBe(DOCUMENT_PREPROCESS_PROMPT);
    expect(PREPROCESS_PROMPTS.image).toBe(IMAGE_PREPROCESS_PROMPT);
    expect(PREPROCESS_PROMPTS.video).toBe(VIDEO_PREPROCESS_PROMPT);
  });

  it("buildAudioPreprocessPrompt substitutes the transcription placeholder", () => {
    const out = buildAudioPreprocessPrompt("Hello world, this is a test.");
    expect(out).toMatch(/audio/i);
    expect(out).toContain("Hello world, this is a test.");
    expect(out).not.toContain("{transcription}");
  });

  it("buildDocumentPreprocessPrompt substitutes the document_text placeholder", () => {
    const out = buildDocumentPreprocessPrompt("Section 1: introduction.");
    expect(out).toMatch(/document/i);
    expect(out).toContain("Section 1: introduction.");
    expect(out).not.toContain("{document_text}");
  });

  it("buildImagePreprocessPrompt returns the base prompt when rawText is empty", () => {
    const out = buildImagePreprocessPrompt("");
    expect(out).toBe(IMAGE_PREPROCESS_PROMPT);
    expect(out).not.toContain("Additional Context");
  });

  it("buildImagePreprocessPrompt appends rawText as Additional Context when provided", () => {
    const out = buildImagePreprocessPrompt("alt-text: a cat on a rug");
    expect(out).toMatch(/image/i);
    expect(out).toContain("Additional Context");
    expect(out).toContain("alt-text: a cat on a rug");
  });

  it("buildVideoPreprocessPrompt returns the base prompt when rawText is empty", () => {
    const out = buildVideoPreprocessPrompt("   ");
    expect(out).toBe(VIDEO_PREPROCESS_PROMPT);
    expect(out).not.toContain("Additional Context");
  });

  it("buildVideoPreprocessPrompt appends rawText as Additional Context when provided", () => {
    const out = buildVideoPreprocessPrompt("transcript: hello viewers");
    expect(out).toMatch(/video/i);
    expect(out).toContain("Additional Context");
    expect(out).toContain("transcript: hello viewers");
  });
});
