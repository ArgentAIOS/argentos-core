/**
 * YouTube Metadata Tool
 *
 * Generates title options, a production-ready description, and packaging notes.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const LinkSchema = Type.Object({
  label: Type.String(),
  url: Type.String(),
});

const ExtraSectionSchema = Type.Object({
  heading: Type.String(),
  lines: Type.Array(Type.String()),
});

const SegmentSchema = Type.Object({
  title: Type.String(),
  duration_sec: Type.Optional(Type.Number()),
});

const YoutubeMetadataSchema = Type.Object({
  episode_title: Type.String({
    description: "Primary episode title/topic.",
  }),
  show_name: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String()),
  key_points: Type.Optional(
    Type.Unsafe<string[] | string>({
      description: "Array of key bullet points, or a newline-delimited string.",
    }),
  ),
  deep_dive: Type.Optional(Type.String()),
  sponsor_name: Type.Optional(Type.String()),
  sponsor_url: Type.Optional(Type.String()),
  sponsor_copy: Type.Optional(Type.String()),
  top_links: Type.Optional(Type.Array(LinkSchema)),
  links: Type.Optional(Type.Array(LinkSchema)),
  extra_sections: Type.Optional(Type.Array(ExtraSectionSchema)),
  metadata_line: Type.Optional(Type.String()),
  divider_line: Type.Optional(Type.String()),
  cta: Type.Optional(Type.String()),
  hashtags: Type.Optional(Type.Array(Type.String())),
  description_style: Type.Optional(
    Type.Union([Type.Literal("standard"), Type.Literal("creator_longform")], {
      description: "Output layout style. Default: standard.",
    }),
  ),
  style_profile_path: Type.Optional(
    Type.String({
      description:
        "Optional local JSON file path with reusable style defaults (links, sections, divider, etc).",
    }),
  ),
  style_notes: Type.Optional(
    Type.String({
      description: "Optional writing style notes or operator-specific formatting guidance.",
    }),
  ),
  style_examples: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Optional operator-provided example descriptions/titles to mimic structure and tone.",
    }),
  ),
  include_timestamps: Type.Optional(Type.Boolean()),
  segments: Type.Optional(Type.Array(SegmentSchema)),
  target_length: Type.Optional(
    Type.Union([Type.Literal("short"), Type.Literal("medium"), Type.Literal("long")], {
      description: "Description verbosity target. Default: medium.",
    }),
  ),
});

type Link = { label: string; url: string };
type Segment = { title: string; durationSec: number };
type ExtraSection = { heading: string; lines: string[] };
type DescriptionStyle = "standard" | "creator_longform";
type StyleProfile = Partial<{
  description_style: DescriptionStyle;
  top_links: Link[];
  links: Link[];
  extra_sections: ExtraSection[];
  metadata_line: string;
  divider_line: string;
  cta: string;
  hashtags: string[];
  style_notes: string;
}>;

function cleanList(values: string[]): string[] {
  return values.map((v) => v.trim()).filter(Boolean);
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function parseKeyPoints(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return cleanList(raw.filter((v) => typeof v === "string") as string[]);
  }
  if (typeof raw === "string") {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.replace(/^[\-\*\d\.\)\s]+/, "").trim())
      .filter(Boolean);
    return cleanList(lines);
  }
  return [];
}

function clampTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 98) return trimmed;
  return `${trimmed.slice(0, 95).trim()}...`;
}

function unique(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

function formatTimestamp(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(secs / 3600);
  const mm = Math.floor((secs % 3600) / 60);
  const ss = secs % 60;
  if (hh > 0) {
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function buildSegments(params: {
  segmentsRaw?: Array<Record<string, unknown>>;
  keyPoints: string[];
}): Segment[] {
  const raw = params.segmentsRaw;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .map((seg) => {
        const title = typeof seg.title === "string" ? seg.title.trim() : "";
        const durationRaw = seg.duration_sec;
        const durationSec =
          typeof durationRaw === "number" && Number.isFinite(durationRaw) && durationRaw > 0
            ? Math.floor(durationRaw)
            : 120;
        if (!title) return undefined;
        return { title, durationSec };
      })
      .filter((seg): seg is Segment => Boolean(seg));
  }

  const defaults = ["Intro", ...params.keyPoints.slice(0, 4), "Deep Dive", "Outro"];
  return unique(defaults).map((title) => ({ title, durationSec: 120 }));
}

function buildTitles(params: {
  episodeTitle: string;
  showName: string;
  keyPoints: string[];
}): string[] {
  const keyPoint = params.keyPoints[0] || "What changed this week";
  const candidates = [
    `${params.episodeTitle} | ${params.showName}`,
    `${params.episodeTitle} (No Hype, Just Signal)`,
    `AI Morning Brief: ${params.episodeTitle}`,
    `${params.episodeTitle} - What It Means for Operators`,
    `The Real Story Behind ${params.episodeTitle}`,
    `${toTitleCase(keyPoint)} + ${params.episodeTitle}`,
  ];
  return unique(candidates).map(clampTitle).slice(0, 6);
}

function normalizeHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const tags = raw
    .filter((v) => typeof v === "string")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean)
    .map((tag) => `#${tag.replace(/\s+/g, "")}`);
  return unique(tags).slice(0, 12);
}

function parseLinks(raw: unknown): Link[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const rec = entry as Record<string, unknown>;
      const label = typeof rec.label === "string" ? rec.label.trim() : "";
      const url = typeof rec.url === "string" ? rec.url.trim() : "";
      if (!label || !url) return undefined;
      return { label, url };
    })
    .filter((entry): entry is Link => Boolean(entry));
}

function parseExtraSections(raw: unknown): ExtraSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const rec = entry as Record<string, unknown>;
      const heading = typeof rec.heading === "string" ? rec.heading.trim() : "";
      if (!heading) return undefined;
      const lines = Array.isArray(rec.lines)
        ? cleanList(rec.lines.filter((v) => typeof v === "string") as string[])
        : [];
      if (lines.length === 0) return undefined;
      return { heading, lines };
    })
    .filter((entry): entry is ExtraSection => Boolean(entry));
}

function loadStyleProfile(rawPath?: string): StyleProfile {
  if (!rawPath) return {};
  const resolved = path.resolve(rawPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`style_profile_path not found: ${resolved}`);
  }
  const json = JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("style_profile_path must contain a JSON object");
  }
  return json as StyleProfile;
}

function descriptionByLength(length: string): {
  includeSummary: boolean;
  includeExtraContext: boolean;
} {
  if (length === "short") {
    return { includeSummary: false, includeExtraContext: false };
  }
  if (length === "long") {
    return { includeSummary: true, includeExtraContext: true };
  }
  return { includeSummary: true, includeExtraContext: false };
}

function buildTimestampLines(segments: Segment[]): string[] {
  let cursor = 0;
  const out: string[] = [];
  for (const seg of segments) {
    out.push(`${formatTimestamp(cursor)} ${seg.title}`);
    cursor += seg.durationSec;
  }
  return out;
}

function buildStandardDescription(params: {
  showName: string;
  episodeTitle: string;
  summary?: string;
  keyPoints: string[];
  deepDive?: string;
  sponsorName?: string;
  sponsorUrl?: string;
  sponsorCopy?: string;
  links: Array<{ label: string; url: string }>;
  cta: string;
  hashtags: string[];
  styleNotes?: string;
  styleExamples: string[];
  includeTimestamps: boolean;
  segments: Segment[];
  targetLength: string;
}): string {
  const mode = descriptionByLength(params.targetLength);
  const lines: string[] = [];

  lines.push(`${params.showName} - ${params.episodeTitle}`);
  lines.push("");

  if (mode.includeSummary && params.summary) {
    lines.push(params.summary.trim());
    lines.push("");
  }

  if (params.keyPoints.length > 0) {
    lines.push("In this episode:");
    for (const point of params.keyPoints) {
      lines.push(`- ${point}`);
    }
    lines.push("");
  }

  if (params.deepDive) {
    lines.push("Deep Dive:");
    lines.push(params.deepDive.trim());
    lines.push("");
  }

  if (mode.includeExtraContext && params.styleNotes) {
    lines.push("Format Notes:");
    lines.push(params.styleNotes.trim());
    lines.push("");
  }

  if (mode.includeExtraContext && params.styleExamples.length > 0) {
    lines.push("Style Anchors:");
    for (const example of params.styleExamples.slice(0, 2)) {
      lines.push(`- ${example}`);
    }
    lines.push("");
  }

  if (params.includeTimestamps) {
    lines.push("Chapters:");
    for (const line of buildTimestampLines(params.segments)) {
      lines.push(line);
    }
    lines.push("");
  }

  if (params.sponsorName) {
    lines.push(`Sponsor: ${params.sponsorName}`);
    if (params.sponsorCopy) {
      lines.push(params.sponsorCopy.trim());
    }
    if (params.sponsorUrl) {
      lines.push(params.sponsorUrl.trim());
    }
    lines.push("");
  }

  if (params.links.length > 0) {
    lines.push("Links:");
    for (const link of params.links) {
      lines.push(`- ${link.label}: ${link.url}`);
    }
    lines.push("");
  }

  lines.push(params.cta);
  if (params.hashtags.length > 0) {
    lines.push("");
    lines.push(params.hashtags.join(" "));
  }

  return lines.join("\n").trim();
}

function buildCreatorLongformDescription(params: {
  showName: string;
  episodeTitle: string;
  summary?: string;
  keyPoints: string[];
  deepDive?: string;
  sponsorName?: string;
  sponsorUrl?: string;
  sponsorCopy?: string;
  topLinks: Link[];
  links: Link[];
  cta: string;
  hashtags: string[];
  styleNotes?: string;
  includeTimestamps: boolean;
  segments: Segment[];
  metadataLine?: string;
  dividerLine: string;
  extraSections: ExtraSection[];
}): string {
  const lines: string[] = [];

  if (params.metadataLine) {
    lines.push(params.metadataLine.trim());
    lines.push("");
  }

  for (const link of params.topLinks) {
    lines.push(`-> ${link.label}: ${link.url}`);
  }
  if (params.topLinks.length > 0) {
    lines.push("");
  }

  if (params.summary) {
    lines.push(params.summary.trim());
    lines.push("");
  } else {
    lines.push(`${params.showName} | ${params.episodeTitle}`);
    lines.push("");
  }

  if (params.deepDive) {
    lines.push(params.deepDive.trim());
    lines.push("");
  }

  if (params.keyPoints.length > 0) {
    lines.push("Inside this breakdown:");
    for (const point of params.keyPoints) {
      lines.push(`- ${point}`);
    }
    lines.push("");
  }

  if (params.includeTimestamps) {
    lines.push("What you'll see:");
    for (const line of buildTimestampLines(params.segments)) {
      lines.push(line);
    }
    lines.push("");
  }

  if (params.styleNotes) {
    lines.push("Context:");
    lines.push(params.styleNotes.trim());
    lines.push("");
  }

  if (params.sponsorName) {
    lines.push(`Sponsor: ${params.sponsorName}`);
    if (params.sponsorCopy) lines.push(params.sponsorCopy.trim());
    if (params.sponsorUrl) lines.push(params.sponsorUrl.trim());
    lines.push("");
  }

  if (params.links.length > 0) {
    lines.push("Links:");
    for (const link of params.links) {
      lines.push(`- ${link.label}: ${link.url}`);
    }
    lines.push("");
  }

  lines.push(params.cta);

  if (params.hashtags.length > 0) {
    lines.push("");
    lines.push(params.hashtags.join(" "));
  }

  if (params.dividerLine.trim()) {
    lines.push("");
    lines.push(params.dividerLine.trim());
    lines.push("");
  }

  for (const section of params.extraSections) {
    lines.push(section.heading.trim());
    for (const line of section.lines) {
      lines.push(line);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function createYoutubeMetadataTool(): AnyAgentTool {
  return {
    label: "YouTube Metadata",
    name: "youtube_metadata_generate",
    description: `Generate YouTube packaging metadata for a podcast/video episode.

Returns:
- title_options
- recommended_title
- description
- pinned_comment
- chapter lines
- thumbnail brief (headline + prompt seed)

Use description_style=creator_longform plus top_links/extra_sections for creator-style long descriptions.`,
    parameters: YoutubeMetadataSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const styleProfilePath = readStringParam(params, "style_profile_path");
      const styleProfile = loadStyleProfile(styleProfilePath);

      const episodeTitle = readStringParam(params, "episode_title", { required: true });
      const showName =
        readStringParam(params, "show_name") || "Argent's Bleeding Edge Morning Show";
      const summary = readStringParam(params, "summary");
      const keyPoints = parseKeyPoints(params.key_points).slice(0, 10);
      const deepDive = readStringParam(params, "deep_dive");
      const sponsorName = readStringParam(params, "sponsor_name");
      const sponsorUrl = readStringParam(params, "sponsor_url");
      const sponsorCopy = readStringParam(params, "sponsor_copy");
      const cta =
        readStringParam(params, "cta") ||
        styleProfile.cta ||
        "Subscribe for daily AI signal, and drop your take in the comments.";
      const styleNotes = readStringParam(params, "style_notes") || styleProfile.style_notes;
      const styleExamples = cleanList(
        Array.isArray(params.style_examples)
          ? (params.style_examples.filter((v) => typeof v === "string") as string[])
          : [],
      );
      const styleFromParams = readStringParam(params, "description_style");
      const descriptionStyle: DescriptionStyle =
        styleFromParams === "creator_longform" ||
        styleProfile.description_style === "creator_longform"
          ? "creator_longform"
          : "standard";

      const includeTimestamps =
        typeof params.include_timestamps === "boolean" ? params.include_timestamps : true;
      const targetLength = readStringParam(params, "target_length") || "medium";
      const hashtags = unique([
        ...normalizeHashtags(styleProfile.hashtags),
        ...normalizeHashtags(params.hashtags),
      ]).slice(0, 12);

      const topLinks = [...parseLinks(styleProfile.top_links), ...parseLinks(params.top_links)];
      const links = [...parseLinks(styleProfile.links), ...parseLinks(params.links)];
      const extraSections = [
        ...parseExtraSections(styleProfile.extra_sections),
        ...parseExtraSections(params.extra_sections),
      ];
      const metadataLine = readStringParam(params, "metadata_line") || styleProfile.metadata_line;
      const dividerLine =
        readStringParam(params, "divider_line") || styleProfile.divider_line || "";

      const segmentsRaw = Array.isArray(params.segments)
        ? (params.segments as Array<Record<string, unknown>>)
        : undefined;
      const segments = buildSegments({ segmentsRaw, keyPoints });
      const titleOptions = buildTitles({ episodeTitle, showName, keyPoints });
      const recommendedTitle = titleOptions[0] || clampTitle(`${episodeTitle} | ${showName}`);

      const description =
        descriptionStyle === "creator_longform"
          ? buildCreatorLongformDescription({
              showName,
              episodeTitle,
              summary,
              keyPoints,
              deepDive,
              sponsorName,
              sponsorUrl,
              sponsorCopy,
              topLinks,
              links,
              cta,
              hashtags,
              styleNotes,
              includeTimestamps,
              segments,
              metadataLine,
              dividerLine,
              extraSections,
            })
          : buildStandardDescription({
              showName,
              episodeTitle,
              summary,
              keyPoints,
              deepDive,
              sponsorName,
              sponsorUrl,
              sponsorCopy,
              links,
              cta,
              hashtags,
              styleNotes,
              styleExamples,
              includeTimestamps,
              segments,
              targetLength,
            });

      const chapterLines = includeTimestamps ? buildTimestampLines(segments) : [];
      const headlineSeed = (episodeTitle.split(/[|:,-]/)[0] || episodeTitle).trim();
      const thumbnailBrief = {
        headline: headlineSeed.slice(0, 42),
        subheadline: keyPoints[0]?.slice(0, 48),
        prompt_seed: `${headlineSeed} / ${keyPoints[0] || "Daily AI intelligence briefing"}`,
      };

      const pinnedComment = [
        `What stood out most from "${episodeTitle}"?`,
        "Drop your take and tell us what we should break down next.",
      ].join(" ");

      return jsonResult({
        show_name: showName,
        episode_title: episodeTitle,
        title_options: titleOptions,
        recommended_title: recommendedTitle,
        description,
        pinned_comment: pinnedComment,
        chapters: chapterLines,
        hashtags,
        description_style: descriptionStyle,
        thumbnail_brief: thumbnailBrief,
        style_notes_applied: styleNotes || null,
        style_examples_count: styleExamples.length,
        style_profile_path_applied: styleProfilePath || null,
      });
    },
  };
}
