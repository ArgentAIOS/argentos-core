import { sanitizeImageBlocks } from "../agents/tool-images.js";
import {
  DEFAULT_INPUT_FILE_MAX_CHARS,
  DEFAULT_INPUT_FILE_MAX_BYTES,
  DEFAULT_INPUT_FILE_MIMES,
  DEFAULT_INPUT_MAX_REDIRECTS,
  DEFAULT_INPUT_PDF_MAX_PAGES,
  DEFAULT_INPUT_PDF_MAX_PIXELS,
  DEFAULT_INPUT_PDF_MIN_TEXT_CHARS,
  DEFAULT_INPUT_TIMEOUT_MS,
  extractFileContentFromSource,
  normalizeMimeList,
} from "../media/input-files.js";
import { detectMime } from "../media/mime.js";

export type ChatAttachment = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content?: unknown;
};

export type ChatImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type ParsedMessageWithImages = {
  message: string;
  images: ChatImageContent[];
};

type AttachmentLog = {
  warn: (message: string) => void;
};

const DEFAULT_MAX_TEXT_CHARS_PER_ATTACHMENT = 20_000;
const DEFAULT_MAX_TOTAL_TEXT_CHARS = 80_000;

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set<string>([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/yaml",
  "application/csv",
  "application/sql",
]);

function normalizeMime(mime?: string): string | undefined {
  if (!mime) {
    return undefined;
  }
  const cleaned = mime.split(";")[0]?.trim().toLowerCase();
  return cleaned || undefined;
}

async function sniffMimeFromBase64(base64: string): Promise<string | undefined> {
  const trimmed = base64.trim();
  if (!trimmed) {
    return undefined;
  }

  const take = Math.min(256, trimmed.length);
  const sliceLen = take - (take % 4);
  if (sliceLen < 8) {
    return undefined;
  }

  try {
    const head = Buffer.from(trimmed.slice(0, sliceLen), "base64");
    return await detectMime({ buffer: head });
  } catch {
    return undefined;
  }
}

function isImageMime(mime?: string): boolean {
  return typeof mime === "string" && mime.startsWith("image/");
}

function isTextMime(mime?: string): boolean {
  if (!mime) {
    return false;
  }
  if (TEXT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    return true;
  }
  return TEXT_MIME_EXACT.has(mime);
}

function isLikelyBase64(value: string): boolean {
  if (value.length < 8 || value.length % 4 !== 0) {
    return false;
  }
  return !/[^A-Za-z0-9+/=]/.test(value);
}

function stripDataUrlPrefix(value: string): string {
  const dataUrlMatch = /^data:[^;]+;base64,(.*)$/i.exec(value.trim());
  if (dataUrlMatch) {
    return dataUrlMatch[1] ?? "";
  }
  return value.trim();
}

function decodeBase64(value: string, label: string): Buffer {
  if (!isLikelyBase64(value)) {
    throw new Error(`attachment ${label}: invalid base64 content`);
  }
  try {
    return Buffer.from(value, "base64");
  } catch {
    throw new Error(`attachment ${label}: invalid base64 content`);
  }
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const trimmed = text.slice(0, maxChars);
  const omitted = text.length - maxChars;
  return `${trimmed}\n\n[...truncated ${omitted} chars]`;
}

function appendAttachmentSections(message: string, sections: string[]): string {
  if (sections.length === 0) {
    return message;
  }
  const prefix = message.trim().length > 0 ? "\n\n" : "";
  const rendered = ["Attached file context:", ...sections].join("\n\n");
  return `${message}${prefix}${rendered}`;
}

/**
 * Parse attachments and extract images as structured content blocks.
 * Returns the message text and an array of image content blocks
 * compatible with Claude API's image format.
 */
export async function parseMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: {
    maxBytes?: number;
    maxImageInputBytes?: number;
    maxTextCharsPerAttachment?: number;
    maxTotalTextChars?: number;
    log?: AttachmentLog;
  },
): Promise<ParsedMessageWithImages> {
  const maxBytes = opts?.maxBytes ?? 5_000_000; // 5 MB
  const maxImageInputBytes = opts?.maxImageInputBytes ?? Math.max(maxBytes * 5, maxBytes);
  const maxTextCharsPerAttachment =
    opts?.maxTextCharsPerAttachment ?? DEFAULT_MAX_TEXT_CHARS_PER_ATTACHMENT;
  const maxTotalTextChars = opts?.maxTotalTextChars ?? DEFAULT_MAX_TOTAL_TEXT_CHARS;
  const log = opts?.log;
  const fileLimits = {
    allowUrl: false,
    allowedMimes: normalizeMimeList(
      [...DEFAULT_INPUT_FILE_MIMES, ...Array.from(TEXT_MIME_EXACT)],
      DEFAULT_INPUT_FILE_MIMES,
    ),
    maxBytes: Math.min(DEFAULT_INPUT_FILE_MAX_BYTES, maxBytes),
    maxChars: Math.min(DEFAULT_INPUT_FILE_MAX_CHARS, maxTotalTextChars),
    maxRedirects: DEFAULT_INPUT_MAX_REDIRECTS,
    timeoutMs: DEFAULT_INPUT_TIMEOUT_MS,
    pdf: {
      maxPages: DEFAULT_INPUT_PDF_MAX_PAGES,
      maxPixels: DEFAULT_INPUT_PDF_MAX_PIXELS,
      minTextChars: DEFAULT_INPUT_PDF_MIN_TEXT_CHARS,
    },
  };
  if (!attachments || attachments.length === 0) {
    return { message, images: [] };
  }

  const images: ChatImageContent[] = [];
  const attachmentSections: string[] = [];
  let remainingTextBudget = Math.max(0, maxTotalTextChars);

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const mime = att.mimeType ?? "";
    const content = att.content;
    const label = att.fileName || att.type || `attachment-${idx + 1}`;
    const providedMime = normalizeMime(mime);

    if (typeof content !== "string") {
      throw new Error(`attachment ${label}: content must be base64 string`);
    }

    const payload = stripDataUrlPrefix(content);
    const isBase64Payload = isLikelyBase64(payload);
    const imageCandidate = isImageMime(providedMime) || att.type === "image";

    if (imageCandidate) {
      const imageBuffer = decodeBase64(payload, label);
      const sizeBytes = imageBuffer.byteLength;
      if (sizeBytes <= 0 || sizeBytes > maxImageInputBytes) {
        throw new Error(
          `attachment ${label}: exceeds size limit (${sizeBytes} > ${maxImageInputBytes} bytes)`,
        );
      }

      const sniffedMime = normalizeMime(await sniffMimeFromBase64(payload));
      if (sniffedMime && !isImageMime(sniffedMime)) {
        log?.warn(`attachment ${label}: detected non-image (${sniffedMime}), dropping`);
        continue;
      }
      if (!sniffedMime && !isImageMime(providedMime)) {
        log?.warn(`attachment ${label}: unable to detect image mime type, dropping`);
        continue;
      }
      if (sniffedMime && providedMime && sniffedMime !== providedMime) {
        log?.warn(
          `attachment ${label}: mime mismatch (${providedMime} -> ${sniffedMime}), using sniffed`,
        );
      }

      images.push({
        type: "image",
        data: payload,
        mimeType: sniffedMime ?? providedMime ?? mime,
      });
      continue;
    }

    let textContent: string | undefined;
    if (!isBase64Payload) {
      textContent = content;
    } else {
      const fileBuffer = decodeBase64(payload, label);
      const sizeBytes = fileBuffer.byteLength;
      if (sizeBytes <= 0 || sizeBytes > maxBytes) {
        throw new Error(
          `attachment ${label}: exceeds size limit (${sizeBytes} > ${maxBytes} bytes)`,
        );
      }

      const sniffedMime = normalizeMime(await sniffMimeFromBase64(payload));
      if (isImageMime(sniffedMime)) {
        images.push({
          type: "image",
          data: payload,
          mimeType: sniffedMime!,
        });
        continue;
      }

      const extractionMime = providedMime ?? sniffedMime;
      if (!extractionMime) {
        log?.warn(`attachment ${label}: missing MIME type, omitting body`);
        attachmentSections.push(`[Attached file omitted: ${label} (unknown)]`);
        continue;
      }
      if (!isTextMime(extractionMime) && !fileLimits.allowedMimes.has(extractionMime)) {
        log?.warn(
          `attachment ${label}: non-text binary attachment (${extractionMime}), omitting body`,
        );
        attachmentSections.push(`[Attached file omitted: ${label} (${extractionMime})]`);
        continue;
      }

      try {
        const extracted = await extractFileContentFromSource({
          source: {
            type: "base64",
            data: payload,
            mediaType: extractionMime,
            filename: label,
          },
          limits: fileLimits,
        });
        textContent = extracted.text;
        if (Array.isArray(extracted.images) && extracted.images.length > 0) {
          images.push(...extracted.images);
        }
      } catch (err) {
        log?.warn(`attachment ${label}: extraction failed (${String(err)}), omitting body`);
        attachmentSections.push(`[Attached file omitted: ${label} (${extractionMime})]`);
        continue;
      }
    }

    const normalizedText = (textContent ?? "").replace(/\r\n/g, "\n").trim();
    if (!normalizedText) {
      log?.warn(`attachment ${label}: empty extracted text, skipping`);
      continue;
    }
    if (remainingTextBudget <= 0) {
      log?.warn(`attachment ${label}: text budget exhausted, skipping`);
      continue;
    }

    const perFileLimit = Math.min(maxTextCharsPerAttachment, remainingTextBudget);
    const clipped = clipText(normalizedText, perFileLimit);
    remainingTextBudget = Math.max(0, remainingTextBudget - clipped.length);
    attachmentSections.push(`[Attached file: ${label}]\n${clipped}`);
  }

  const sanitized = await sanitizeImageBlocks(images, "gateway:attachment", {
    maxBytes,
  });
  if (sanitized.dropped > 0) {
    log?.warn(`dropped ${sanitized.dropped} image attachment(s) after resizing`);
  }

  return {
    message: appendAttachmentSections(message, attachmentSections),
    images: sanitized.images,
  };
}

/**
 * @deprecated Use parseMessageWithAttachments instead.
 * This function converts images to markdown data URLs which Claude API cannot process as images.
 */
export function buildMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number },
): string {
  const maxBytes = opts?.maxBytes ?? 2_000_000; // 2 MB
  if (!attachments || attachments.length === 0) {
    return message;
  }

  const blocks: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const mime = att.mimeType ?? "";
    const content = att.content;
    const label = att.fileName || att.type || `attachment-${idx + 1}`;

    if (typeof content !== "string") {
      throw new Error(`attachment ${label}: content must be base64 string`);
    }
    if (!mime.startsWith("image/")) {
      throw new Error(`attachment ${label}: only image/* supported`);
    }

    let sizeBytes = 0;
    const b64 = content.trim();
    // Basic base64 sanity: length multiple of 4 and charset check.
    if (b64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(b64)) {
      throw new Error(`attachment ${label}: invalid base64 content`);
    }
    try {
      sizeBytes = Buffer.from(b64, "base64").byteLength;
    } catch {
      throw new Error(`attachment ${label}: invalid base64 content`);
    }
    if (sizeBytes <= 0 || sizeBytes > maxBytes) {
      throw new Error(`attachment ${label}: exceeds size limit (${sizeBytes} > ${maxBytes} bytes)`);
    }

    const safeLabel = label.replace(/\s+/g, "_");
    const dataUrl = `![${safeLabel}](data:${mime};base64,${content})`;
    blocks.push(dataUrl);
  }

  if (blocks.length === 0) {
    return message;
  }
  const separator = message.trim().length > 0 ? "\n\n" : "";
  return `${message}${separator}${blocks.join("\n\n")}`;
}
