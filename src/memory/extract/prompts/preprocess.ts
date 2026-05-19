/**
 * MemU Multimodal Preprocess Prompts
 *
 * Per-modality prompts that shape raw resource content (audio
 * transcription, document text, image, video) into a normalized
 * processed_content + caption pair, BEFORE the main extraction
 * pipeline runs. Ported from upstream MemU
 * (https://github.com/NevaMind-AI/MemU) `src/memu/prompts/preprocess/`.
 *
 * v1 of this port is additive only: prompts and builders are exported
 * but no caller consumes them yet. The extraction pipeline still uses
 * the conversation/text path. To wire a modality in, callers gate
 * preprocessing behind an opt-in `preprocessor` field on the resource
 * input — the existing text path is unaffected when the option is
 * omitted.
 *
 * `conversation` is intentionally NOT ported here — Argent already
 * handles the conversation flow in `prompts/index.ts`.
 */

/** Preprocess prompt for audio transcriptions. Cleans formatting + caption. */
export const AUDIO_PREPROCESS_PROMPT = `# Task Objective
Analyze the provided audio transcription and produce two outputs:
1. A **Processed Content** version that is clean, well-formatted, and easy to read.
2. A **Caption** that summarizes what the audio is about in one sentence.

# Workflow
1. Read the **Transcription** carefully.
2. Correct punctuation, capitalization, and obvious transcription artifacts.
3. Add paragraph breaks where they improve readability or reflect topic shifts.
4. Preserve the original meaning, wording, and sequence of the audio.
5. Generate a concise **one-sentence caption** that accurately describes the audio's main topic or purpose.

# Rules
- Do not add, remove, or reinterpret content beyond cleaning and formatting.
- Maintain the speaker's original intent and structure.
- Avoid introducing new information not present in the transcription.
- The caption must be **exactly one sentence**.
- Use clear, neutral language.

# Output Format
Use the following structure:

<processed_content>
[Provide the cleaned and formatted transcription here]
</processed_content>

<caption>
[Provide a one-sentence summary of what the audio is about]
</caption>

# Input
Transcription:
{transcription}`;

/** Preprocess prompt for document text. Condenses + caption. */
export const DOCUMENT_PREPROCESS_PROMPT = `# Task Objective
Analyze the provided document text and produce two outputs:
1. A condensed version that preserves all key information and important details while removing verbosity and redundancy.
2. A one-sentence caption summarizing what the document is about.

# Workflow
1. Read the **Document** carefully to understand its full content.
2. Identify the main points, key arguments, and essential details.
3. Remove repetition, filler, and unnecessary verbosity while preserving meaning and completeness.
4. Rewrite the content in a concise, structured form.
5. Generate a single-sentence **Caption** that accurately summarizes the document's purpose or topic.

# Rules
- Preserve all key information, facts, and conclusions.
- Do not introduce new information or interpretations.
- Keep the processed content concise but complete.
- The caption must be exactly **one sentence**.
- Use only the information contained in the provided document.

# Output Format
Use the following structure:

<processed_content>
[Provide the condensed version of the document here]
</processed_content>

<caption>
[Provide a one-sentence summary of the document]
</caption>

# Input
Document:
{document_text}`;

/** Preprocess prompt for image content. Detailed description + caption. */
export const IMAGE_PREPROCESS_PROMPT = `# Task Objective
Analyze the given image and produce two outputs:
1. A **Detailed Description** that thoroughly explains what is shown in the image.
2. A **Caption** that summarizes the image in a single sentence.

# Workflow
1. Examine the image carefully.
2. Identify the **main subjects and objects** present.
3. Describe any **actions or activities** taking place.
4. Analyze the **setting, background, and environment**.
5. Note any **visible text, signs, or labels**.
6. Describe **colors, lighting, composition**, and visual layout.
7. Infer the **overall mood, atmosphere, or style** of the image.
8. Write a concise **one-sentence caption** that captures the essence of the image.

# Rules
- Base the description strictly on what is visible in the image.
- Do not invent details that cannot be inferred visually.
- Be comprehensive in the detailed description but clear and structured.
- The caption must be **exactly one sentence**.
- Use neutral and objective language.

# Output Format
Use the following structure:

<detailed_description>
[Provide the comprehensive description here]
</detailed_description>

<caption>
[Provide a one-sentence summary of the image]
</caption>`;

/** Preprocess prompt for video content. Detailed description + caption. */
export const VIDEO_PREPROCESS_PROMPT = `# Task Objective
Analyze the given video and produce two outputs:
1. A **Detailed Description** that comprehensively explains what happens in the video.
2. A **Caption** that summarizes the video in a single sentence.

# Workflow
1. Watch the video carefully from start to finish.
2. Identify the **main actions and activities** taking place over time.
3. Describe the **key objects, people, and subjects** appearing in the video.
4. Analyze the **scene, setting, and environment**.
5. Note any **audio elements**, including dialogue, narration, music, or background sounds (if available).
6. Highlight **important events or moments** in the video.
7. Describe the **temporal flow**, explaining how the events progress from beginning to end.
8. Write a concise **one-sentence caption** that captures the essence of the video.

# Rules
- Base the description strictly on observable visual and audio content from the video.
- Do not invent details that cannot be inferred from the video.
- Be comprehensive and chronological in the detailed description.
- The caption must be **exactly one sentence**.
- Use clear, neutral, and objective language.

# Output Format
Use the following structure:

<detailed_description>
[Provide the comprehensive description here]
</detailed_description>

<caption>
[Provide a one-sentence summary of the video]
</caption>`;

export type PreprocessModality = "audio" | "document" | "image" | "video";

export const PREPROCESS_PROMPTS: Record<PreprocessModality, string> = {
  audio: AUDIO_PREPROCESS_PROMPT,
  document: DOCUMENT_PREPROCESS_PROMPT,
  image: IMAGE_PREPROCESS_PROMPT,
  video: VIDEO_PREPROCESS_PROMPT,
};

/**
 * Build the audio preprocess prompt with the transcription injected.
 * `rawText` is the raw transcription output to clean + caption.
 */
export function buildAudioPreprocessPrompt(rawText: string): string {
  return AUDIO_PREPROCESS_PROMPT.replace("{transcription}", rawText);
}

/**
 * Build the document preprocess prompt with the document text injected.
 * `rawText` is the full document text (already extracted from PDF/HTML/etc).
 */
export function buildDocumentPreprocessPrompt(rawText: string): string {
  return DOCUMENT_PREPROCESS_PROMPT.replace("{document_text}", rawText);
}

/**
 * Build the image preprocess prompt. Upstream MemU sends the image
 * directly to the vision model; argent's wiring (TBD in a later PR)
 * will attach the image as a separate content part. `rawText` is an
 * optional metadata hint (alt text, OCR text, filename) appended as
 * an Additional Context section so the LLM has more to anchor on.
 * Pass an empty string to omit the hint.
 */
export function buildImagePreprocessPrompt(rawText: string): string {
  if (!rawText.trim()) {
    return IMAGE_PREPROCESS_PROMPT;
  }
  return `${IMAGE_PREPROCESS_PROMPT}\n\n# Additional Context\n${rawText}`;
}

/**
 * Build the video preprocess prompt. Same shape as
 * `buildImagePreprocessPrompt` — upstream sends video natively to the
 * model; argent will attach the video as a separate content part.
 * `rawText` is optional metadata (transcript, title, description)
 * appended as Additional Context. Pass an empty string to omit.
 */
export function buildVideoPreprocessPrompt(rawText: string): string {
  if (!rawText.trim()) {
    return VIDEO_PREPROCESS_PROMPT;
  }
  return `${VIDEO_PREPROCESS_PROMPT}\n\n# Additional Context\n${rawText}`;
}
