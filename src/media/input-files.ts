import { fetchWithSsrFGuard } from "../infra/net/fetch-guard.js";
import { logWarn } from "../logger.js";

type CanvasModule = typeof import("@napi-rs/canvas");
type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type JsZipModule = typeof import("jszip");

let canvasModulePromise: Promise<CanvasModule> | null = null;
let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
let jsZipModulePromise: Promise<JsZipModule> | null = null;

// Lazy-load optional PDF/image deps so non-PDF paths don't require native installs.
async function loadCanvasModule(): Promise<CanvasModule> {
  if (!canvasModulePromise) {
    canvasModulePromise = import("@napi-rs/canvas").catch((err) => {
      canvasModulePromise = null;
      throw new Error(
        `Optional dependency @napi-rs/canvas is required for PDF image extraction: ${String(err)}`,
      );
    });
  }
  return canvasModulePromise;
}

async function loadPdfJsModule(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs").catch((err) => {
      pdfJsModulePromise = null;
      throw new Error(
        `Optional dependency pdfjs-dist is required for PDF extraction: ${String(err)}`,
      );
    });
  }
  return pdfJsModulePromise;
}

async function loadJsZipModule(): Promise<JsZipModule> {
  if (!jsZipModulePromise) {
    jsZipModulePromise = import("jszip").catch((err) => {
      jsZipModulePromise = null;
      throw new Error(
        `Optional dependency jszip is required for Office extraction: ${String(err)}`,
      );
    });
  }
  return jsZipModulePromise;
}

export type InputImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type InputFileExtractResult = {
  filename: string;
  text?: string;
  images?: InputImageContent[];
};

export type InputPdfLimits = {
  maxPages: number;
  maxPixels: number;
  minTextChars: number;
};

export type InputFileLimits = {
  allowUrl: boolean;
  allowedMimes: Set<string>;
  maxBytes: number;
  maxChars: number;
  maxRedirects: number;
  timeoutMs: number;
  pdf: InputPdfLimits;
};

export type InputImageLimits = {
  allowUrl: boolean;
  allowedMimes: Set<string>;
  maxBytes: number;
  maxRedirects: number;
  timeoutMs: number;
};

export type InputImageSource = {
  type: "base64" | "url";
  data?: string;
  url?: string;
  mediaType?: string;
};

export type InputFileSource = {
  type: "base64" | "url";
  data?: string;
  url?: string;
  mediaType?: string;
  filename?: string;
};

export type InputFetchResult = {
  buffer: Buffer;
  mimeType: string;
  contentType?: string;
};

export const DEFAULT_INPUT_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
export const DEFAULT_INPUT_FILE_MIMES = [
  "text/plain",
  "text/markdown",
  "text/html",
  "text/csv",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
export const DEFAULT_INPUT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_INPUT_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_INPUT_FILE_MAX_CHARS = 200_000;
export const DEFAULT_INPUT_MAX_REDIRECTS = 3;
export const DEFAULT_INPUT_TIMEOUT_MS = 10_000;
export const DEFAULT_INPUT_PDF_MAX_PAGES = 4;
export const DEFAULT_INPUT_PDF_MAX_PIXELS = 4_000_000;
export const DEFAULT_INPUT_PDF_MIN_TEXT_CHARS = 200;

export function normalizeMimeType(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const [raw] = value.split(";");
  const normalized = raw?.trim().toLowerCase();
  return normalized || undefined;
}

export function parseContentType(value: string | undefined): {
  mimeType?: string;
  charset?: string;
} {
  if (!value) {
    return {};
  }
  const parts = value.split(";").map((part) => part.trim());
  const mimeType = normalizeMimeType(parts[0]);
  const charset = parts
    .map((part) => part.match(/^charset=(.+)$/i)?.[1]?.trim())
    .find((part) => part && part.length > 0);
  return { mimeType, charset };
}

export function normalizeMimeList(values: string[] | undefined, fallback: string[]): Set<string> {
  const input = values && values.length > 0 ? values : fallback;
  return new Set(input.map((value) => normalizeMimeType(value)).filter(Boolean) as string[]);
}

export async function fetchWithGuard(params: {
  url: string;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}): Promise<InputFetchResult> {
  const { response, release } = await fetchWithSsrFGuard({
    url: params.url,
    maxRedirects: params.maxRedirects,
    timeoutMs: params.timeoutMs,
    init: { headers: { "User-Agent": "ArgentOS-Gateway/1.0" } },
  });

  try {
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > params.maxBytes) {
        throw new Error(`Content too large: ${size} bytes (limit: ${params.maxBytes} bytes)`);
      }
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > params.maxBytes) {
      throw new Error(
        `Content too large: ${buffer.byteLength} bytes (limit: ${params.maxBytes} bytes)`,
      );
    }

    const contentType = response.headers.get("content-type") || undefined;
    const parsed = parseContentType(contentType);
    const mimeType = parsed.mimeType ?? "application/octet-stream";
    return { buffer, mimeType, contentType };
  } finally {
    await release();
  }
}

function decodeTextContent(buffer: Buffer, charset: string | undefined): string {
  const encoding = charset?.trim().toLowerCase() || "utf-8";
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

function collapseWhitespacePreserveLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function extractDocxXmlText(xml: string): string {
  const withMarkers = xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n");
  const withoutTags = withMarkers.replace(/<[^>]+>/g, "");
  return collapseWhitespacePreserveLines(decodeXmlEntities(withoutTags));
}

async function extractDocxContent(buffer: Buffer): Promise<string> {
  const jszip = await loadJsZipModule();
  const zip = await jszip.default.loadAsync(buffer);

  const docParts = Object.keys(zip.files)
    .filter((name) => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name))
    .sort();

  if (docParts.length === 0) {
    return "";
  }

  const sections: string[] = [];
  for (const part of docParts) {
    const file = zip.file(part);
    if (!file) {
      continue;
    }
    const xml = await file.async("string");
    const text = extractDocxXmlText(xml);
    if (text) {
      sections.push(text);
    }
  }
  return sections.join("\n\n");
}

function extractSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const block = match[1] ?? "";
    const withLineBreaks = block.replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
    const text = collapseWhitespacePreserveLines(
      decodeXmlEntities(withLineBreaks.replace(/<[^>]+>/g, "")),
    );
    out.push(text);
  }
  return out;
}

function cellRefFromAttrs(attrs: string): string | undefined {
  return attrs.match(/\br="([^"]+)"/)?.[1];
}

function cellTypeFromAttrs(attrs: string): string | undefined {
  return attrs.match(/\bt="([^"]+)"/)?.[1];
}

function extractCellText(body: string, type: string | undefined, sharedStrings: string[]): string {
  if (type === "inlineStr") {
    const inline = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? "";
    return collapseWhitespacePreserveLines(decodeXmlEntities(inline.replace(/<[^>]+>/g, "")));
  }

  const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (!raw) {
    return "";
  }

  if (type === "s") {
    const idx = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(idx) && idx >= 0 && idx < sharedStrings.length) {
      return sharedStrings[idx] ?? "";
    }
    return "";
  }

  if (type === "b") {
    return raw.trim() === "1" ? "TRUE" : "FALSE";
  }

  return decodeXmlEntities(raw.trim());
}

function extractWorksheetText(xml: string, sharedStrings: string[]): string {
  const rows: string[] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowBody = rowMatch[1] ?? "";
    const cells: string[] = [];
    for (const cellMatch of rowBody.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const ref = cellRefFromAttrs(attrs);
      const type = cellTypeFromAttrs(attrs);
      const value = extractCellText(body, type, sharedStrings);
      if (!value) {
        continue;
      }
      cells.push(ref ? `${ref}:${value}` : value);
    }
    if (cells.length > 0) {
      rows.push(cells.join("\t"));
    }
  }
  return rows.join("\n");
}

async function extractXlsxContent(buffer: Buffer): Promise<string> {
  const jszip = await loadJsZipModule();
  const zip = await jszip.default.loadAsync(buffer);

  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsFile
    ? extractSharedStrings(await sharedStringsFile.async("string"))
    : [];

  const sheetFiles = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort();
  if (sheetFiles.length === 0) {
    return "";
  }

  const sections: string[] = [];
  for (const sheetFile of sheetFiles) {
    const file = zip.file(sheetFile);
    if (!file) {
      continue;
    }
    const xml = await file.async("string");
    const text = extractWorksheetText(xml, sharedStrings);
    if (text) {
      sections.push(`[${sheetFile.split("/").pop() ?? "sheet"}]\n${text}`);
    }
  }

  return sections.join("\n\n");
}

async function extractPdfContent(params: {
  buffer: Buffer;
  limits: InputFileLimits;
}): Promise<{ text: string; images: InputImageContent[] }> {
  const { buffer, limits } = params;
  const { getDocument } = await loadPdfJsModule();
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
  }).promise;
  const maxPages = Math.min(pdf.numPages, limits.pdf.maxPages);
  const textParts: string[] = [];

  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .filter(Boolean)
      .join(" ");
    if (pageText) {
      textParts.push(pageText);
    }
  }

  const text = textParts.join("\n\n");
  if (text.trim().length >= limits.pdf.minTextChars) {
    return { text, images: [] };
  }

  let canvasModule: CanvasModule;
  try {
    canvasModule = await loadCanvasModule();
  } catch (err) {
    logWarn(`media: PDF image extraction skipped; ${String(err)}`);
    return { text, images: [] };
  }
  const { createCanvas } = canvasModule;
  const images: InputImageContent[] = [];
  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const maxPixels = limits.pdf.maxPixels;
    const pixelBudget = Math.max(1, maxPixels);
    const pagePixels = viewport.width * viewport.height;
    const scale = Math.min(1, Math.sqrt(pixelBudget / pagePixels));
    const scaled = page.getViewport({ scale: Math.max(0.1, scale) });
    const canvas = createCanvas(Math.ceil(scaled.width), Math.ceil(scaled.height));
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport: scaled,
    }).promise;
    const png = canvas.toBuffer("image/png");
    images.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
  }

  return { text, images };
}

export async function extractImageContentFromSource(
  source: InputImageSource,
  limits: InputImageLimits,
): Promise<InputImageContent> {
  if (source.type === "base64") {
    if (!source.data) {
      throw new Error("input_image base64 source missing 'data' field");
    }
    const mimeType = normalizeMimeType(source.mediaType) ?? "image/png";
    if (!limits.allowedMimes.has(mimeType)) {
      throw new Error(`Unsupported image MIME type: ${mimeType}`);
    }
    const buffer = Buffer.from(source.data, "base64");
    if (buffer.byteLength > limits.maxBytes) {
      throw new Error(
        `Image too large: ${buffer.byteLength} bytes (limit: ${limits.maxBytes} bytes)`,
      );
    }
    return { type: "image", data: source.data, mimeType };
  }

  if (source.type === "url" && source.url) {
    if (!limits.allowUrl) {
      throw new Error("input_image URL sources are disabled by config");
    }
    const result = await fetchWithGuard({
      url: source.url,
      maxBytes: limits.maxBytes,
      timeoutMs: limits.timeoutMs,
      maxRedirects: limits.maxRedirects,
    });
    if (!limits.allowedMimes.has(result.mimeType)) {
      throw new Error(`Unsupported image MIME type from URL: ${result.mimeType}`);
    }
    return { type: "image", data: result.buffer.toString("base64"), mimeType: result.mimeType };
  }

  throw new Error("input_image must have 'source.url' or 'source.data'");
}

export async function extractFileContentFromSource(params: {
  source: InputFileSource;
  limits: InputFileLimits;
}): Promise<InputFileExtractResult> {
  const { source, limits } = params;
  const filename = source.filename || "file";

  let buffer: Buffer;
  let mimeType: string | undefined;
  let charset: string | undefined;

  if (source.type === "base64") {
    if (!source.data) {
      throw new Error("input_file base64 source missing 'data' field");
    }
    const parsed = parseContentType(source.mediaType);
    mimeType = parsed.mimeType;
    charset = parsed.charset;
    buffer = Buffer.from(source.data, "base64");
  } else if (source.type === "url" && source.url) {
    if (!limits.allowUrl) {
      throw new Error("input_file URL sources are disabled by config");
    }
    const result = await fetchWithGuard({
      url: source.url,
      maxBytes: limits.maxBytes,
      timeoutMs: limits.timeoutMs,
      maxRedirects: limits.maxRedirects,
    });
    const parsed = parseContentType(result.contentType);
    mimeType = parsed.mimeType ?? normalizeMimeType(result.mimeType);
    charset = parsed.charset;
    buffer = result.buffer;
  } else {
    throw new Error("input_file must have 'source.url' or 'source.data'");
  }

  if (buffer.byteLength > limits.maxBytes) {
    throw new Error(`File too large: ${buffer.byteLength} bytes (limit: ${limits.maxBytes} bytes)`);
  }

  if (!mimeType) {
    throw new Error("input_file missing media type");
  }
  if (!limits.allowedMimes.has(mimeType)) {
    throw new Error(`Unsupported file MIME type: ${mimeType}`);
  }

  if (mimeType === "application/pdf") {
    const extracted = await extractPdfContent({ buffer, limits });
    const text = extracted.text ? clampText(extracted.text, limits.maxChars) : "";
    return {
      filename,
      text,
      images: extracted.images.length > 0 ? extracted.images : undefined,
    };
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const text = clampText(await extractDocxContent(buffer), limits.maxChars);
    return { filename, text };
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const text = clampText(await extractXlsxContent(buffer), limits.maxChars);
    return { filename, text };
  }

  const text = clampText(decodeTextContent(buffer, charset), limits.maxChars);
  return { filename, text };
}
