import { describe, expect, it } from "vitest";
import type { ForgeStructuredField } from "../../hooks/useForgeStructuredData";
import {
  extractAttachmentUrls,
  pickThumbnailUrl,
  resolveThumbnailField,
  selectGalleryBodyFields,
} from "./gallery-card";

function field(id: string, type: ForgeStructuredField["type"]): ForgeStructuredField {
  return { id, name: id, type };
}

describe("extractAttachmentUrls", () => {
  it("splits a comma-separated list of plain URLs", () => {
    expect(extractAttachmentUrls("https://a.example/one.png, https://a.example/two.png")).toEqual([
      "https://a.example/one.png",
      "https://a.example/two.png",
    ]);
  });

  it("splits a newline-separated list (mixed delimiters)", () => {
    expect(extractAttachmentUrls("https://a.example/one.png\nhttps://a.example/two.png")).toEqual([
      "https://a.example/one.png",
      "https://a.example/two.png",
    ]);
  });

  it("parses `name|url` pairs and returns only the URL part", () => {
    expect(extractAttachmentUrls("Hero shot|https://a.example/hero.png")).toEqual([
      "https://a.example/hero.png",
    ]);
  });

  it("handles a mix of `name|url` and plain URLs", () => {
    expect(
      extractAttachmentUrls(
        "Cover|https://a.example/cover.png, https://a.example/plain.png, B-roll|https://a.example/b.png",
      ),
    ).toEqual([
      "https://a.example/cover.png",
      "https://a.example/plain.png",
      "https://a.example/b.png",
    ]);
  });

  it("accepts a pre-split string array", () => {
    expect(
      extractAttachmentUrls(["Cover|https://a.example/cover.png", "https://a.example/two.png"]),
    ).toEqual(["https://a.example/cover.png", "https://a.example/two.png"]);
  });

  it("returns an empty array for missing / empty / non-string input", () => {
    expect(extractAttachmentUrls(undefined)).toEqual([]);
    expect(extractAttachmentUrls(null)).toEqual([]);
    expect(extractAttachmentUrls("")).toEqual([]);
    expect(extractAttachmentUrls("   ,  ")).toEqual([]);
    expect(extractAttachmentUrls(42)).toEqual([]);
    expect(extractAttachmentUrls({ url: "https://a.example/x.png" })).toEqual([]);
  });

  it("drops `name|url` entries whose URL part is empty", () => {
    // A trailing pipe with nothing after it should be skipped, not yield
    // an empty-string URL the renderer would try to load.
    expect(extractAttachmentUrls("Cover|")).toEqual([]);
    expect(extractAttachmentUrls("Cover|, https://a.example/ok.png")).toEqual([
      "https://a.example/ok.png",
    ]);
  });
});

describe("pickThumbnailUrl", () => {
  it("returns the first usable URL on a record cell", () => {
    expect(pickThumbnailUrl("https://a.example/one.png, https://a.example/two.png")).toBe(
      "https://a.example/one.png",
    );
    expect(pickThumbnailUrl("Hero|https://a.example/hero.png")).toBe("https://a.example/hero.png");
  });

  it("returns null when no usable URL is present", () => {
    expect(pickThumbnailUrl(undefined)).toBeNull();
    expect(pickThumbnailUrl("")).toBeNull();
    expect(pickThumbnailUrl("Cover|")).toBeNull();
    expect(pickThumbnailUrl(42)).toBeNull();
  });
});

describe("resolveThumbnailField", () => {
  it("prefers the named field when it is an attachment field", () => {
    const fields = [
      field("name", "text"),
      field("cover", "attachment"),
      field("gallery", "attachment"),
    ];
    expect(resolveThumbnailField(fields, "gallery")?.id).toBe("gallery");
  });

  it("falls back to the first attachment field when the named field is wrong type", () => {
    const fields = [
      field("name", "text"),
      field("cover", "attachment"),
      field("notes", "long_text"),
    ];
    // `name` exists but is a text field — gallery should fall back, not crash.
    expect(resolveThumbnailField(fields, "name")?.id).toBe("cover");
  });

  it("falls back to the first attachment field when the named field id is unknown", () => {
    const fields = [field("cover", "attachment"), field("alt", "attachment")];
    expect(resolveThumbnailField(fields, "does-not-exist")?.id).toBe("cover");
  });

  it("returns null when the table has no attachment fields", () => {
    const fields = [field("name", "text"), field("notes", "long_text")];
    expect(resolveThumbnailField(fields, "name")).toBeNull();
    expect(resolveThumbnailField(fields)).toBeNull();
  });
});

describe("selectGalleryBodyFields", () => {
  it("excludes the thumbnail field, skips long_text, and caps at 4 by default", () => {
    const fields = [
      field("cover", "attachment"),
      field("title", "text"),
      field("status", "single_select"),
      field("priority", "number"),
      field("owner", "text"),
      field("notes", "long_text"),
      field("extra1", "text"),
      field("extra2", "text"),
    ];
    const body = selectGalleryBodyFields(fields, { thumbnailFieldId: "cover" });
    expect(body.map((f) => f.id)).toEqual(["title", "status", "priority", "owner"]);
  });

  it("honors a custom limit", () => {
    const fields = [
      field("title", "text"),
      field("status", "single_select"),
      field("owner", "text"),
    ];
    expect(selectGalleryBodyFields(fields, { limit: 2 }).map((f) => f.id)).toEqual([
      "title",
      "status",
    ]);
    expect(selectGalleryBodyFields(fields, { limit: 0 })).toEqual([]);
  });

  it("clamps a negative limit to zero", () => {
    const fields = [field("title", "text")];
    expect(selectGalleryBodyFields(fields, { limit: -5 })).toEqual([]);
  });

  it("works without a thumbnail field id (text-only card)", () => {
    const fields = [field("title", "text"), field("status", "single_select")];
    expect(selectGalleryBodyFields(fields).map((f) => f.id)).toEqual(["title", "status"]);
  });

  it("returns an empty list when the table has only long_text and the thumbnail", () => {
    const fields = [field("cover", "attachment"), field("notes", "long_text")];
    expect(selectGalleryBodyFields(fields, { thumbnailFieldId: "cover" })).toEqual([]);
  });
});
