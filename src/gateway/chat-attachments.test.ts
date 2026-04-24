import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  buildMessageWithAttachments,
  type ChatAttachment,
  parseMessageWithAttachments,
} from "./chat-attachments.js";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

async function buildDocxBase64(text: string): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf.toString("base64");
}

async function buildXlsxBase64(): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>Hello</t></si></sst>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>`,
  );
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf.toString("base64");
}

describe("buildMessageWithAttachments", () => {
  it("embeds a single image as data URL", () => {
    const msg = buildMessageWithAttachments("see this", [
      {
        type: "image",
        mimeType: "image/png",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(msg).toContain("see this");
    expect(msg).toContain(`data:image/png;base64,${PNG_1x1}`);
    expect(msg).toContain("![dot.png]");
  });

  it("rejects non-image mime types", () => {
    const bad: ChatAttachment = {
      type: "file",
      mimeType: "application/pdf",
      fileName: "a.pdf",
      content: "AAA",
    };
    expect(() => buildMessageWithAttachments("x", [bad])).toThrow(/image/);
  });

  it("rejects invalid base64 content", () => {
    const bad: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "dot.png",
      content: "%not-base64%",
    };
    expect(() => buildMessageWithAttachments("x", [bad])).toThrow(/base64/);
  });

  it("rejects images over limit", () => {
    const big = Buffer.alloc(6_000_000, 0).toString("base64");
    const att: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "big.png",
      content: big,
    };
    expect(() => buildMessageWithAttachments("x", [att], { maxBytes: 5_000_000 })).toThrow(
      /exceeds size limit/i,
    );
  });
});

describe("parseMessageWithAttachments", () => {
  it("strips data URL prefix", async () => {
    const parsed = await parseMessageWithAttachments(
      "see this",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "dot.png",
          content: `data:image/png;base64,${PNG_1x1}`,
        },
      ],
      { log: { warn: () => {} } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
  });

  it("rejects invalid base64 content", async () => {
    await expect(
      parseMessageWithAttachments(
        "x",
        [
          {
            type: "image",
            mimeType: "image/png",
            fileName: "dot.png",
            content: "%not-base64%",
          },
        ],
        { log: { warn: () => {} } },
      ),
    ).rejects.toThrow(/base64/i);
  });

  it("rejects images over limit", async () => {
    const big = Buffer.alloc(6_000_000, 0).toString("base64");
    await expect(
      parseMessageWithAttachments(
        "x",
        [
          {
            type: "image",
            mimeType: "image/png",
            fileName: "big.png",
            content: big,
          },
        ],
        { maxBytes: 5_000_000, maxImageInputBytes: 5_000_000, log: { warn: () => {} } },
      ),
    ).rejects.toThrow(/exceeds size limit/i);
  });

  it("resizes image attachments that exceed provider dimensions", async () => {
    const png = await sharp({
      create: {
        width: 2952,
        height: 1714,
        channels: 3,
        background: { r: 120, g: 140, b: 160 },
      },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const parsed = await parseMessageWithAttachments(
      "what does this show?",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "screenshot.png",
          content: png.toString("base64"),
        },
      ],
      { log: { warn: () => {} } },
    );

    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(parsed.images[0]!.data, "base64")).metadata();
    expect(meta.width).toBeLessThanOrEqual(2000);
    expect(meta.height).toBeLessThanOrEqual(2000);
  }, 20_000);

  it("sniffs mime when missing", async () => {
    const logs: string[] = [];
    const parsed = await parseMessageWithAttachments(
      "see this",
      [
        {
          type: "image",
          fileName: "dot.png",
          content: PNG_1x1,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.message).toBe("see this");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(logs).toHaveLength(0);
  });

  it("drops non-image payloads and logs", async () => {
    const logs: string[] = [];
    const pdf = Buffer.from("%PDF-1.4\n").toString("base64");
    const parsed = await parseMessageWithAttachments(
      "x",
      [
        {
          type: "file",
          mimeType: "image/png",
          fileName: "not-image.pdf",
          content: pdf,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/non-image/i);
  });

  it("prefers sniffed mime type and logs mismatch", async () => {
    const logs: string[] = [];
    const parsed = await parseMessageWithAttachments(
      "x",
      [
        {
          type: "image",
          mimeType: "image/jpeg",
          fileName: "dot.png",
          content: PNG_1x1,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/mime mismatch/i);
  });

  it("drops unknown mime when sniff fails and logs", async () => {
    const logs: string[] = [];
    const unknown = Buffer.from("not an image").toString("base64");
    const parsed = await parseMessageWithAttachments(
      "x",
      [{ type: "file", fileName: "unknown.bin", content: unknown }],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/missing MIME type/i);
    expect(parsed.message).toContain("Attached file omitted: unknown.bin");
  });

  it("keeps valid images and drops invalid ones", async () => {
    const logs: string[] = [];
    const pdf = Buffer.from("%PDF-1.4\n").toString("base64");
    const parsed = await parseMessageWithAttachments(
      "x",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "dot.png",
          content: PNG_1x1,
        },
        {
          type: "file",
          mimeType: "image/png",
          fileName: "not-image.pdf",
          content: pdf,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(logs.some((l) => /non-image/i.test(l))).toBe(true);
  });

  it("injects plain text file content into message context", async () => {
    const parsed = await parseMessageWithAttachments(
      "Please review",
      [
        {
          type: "document",
          mimeType: "text/plain",
          fileName: "notes.txt",
          content: "line one\nline two",
        },
      ],
      { log: { warn: () => {} } },
    );
    expect(parsed.images).toHaveLength(0);
    expect(parsed.message).toContain("Attached file context:");
    expect(parsed.message).toContain("[Attached file: notes.txt]");
    expect(parsed.message).toContain("line one");
  });

  it("extracts DOCX attachment text into message context", async () => {
    const docx = await buildDocxBase64("Client intake summary");
    const parsed = await parseMessageWithAttachments(
      "Review this document",
      [
        {
          type: "document",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          fileName: "intake.docx",
          content: docx,
        },
      ],
      { log: { warn: () => {} } },
    );
    expect(parsed.images).toHaveLength(0);
    expect(parsed.message).toContain("[Attached file: intake.docx]");
    expect(parsed.message).toContain("Client intake summary");
  });

  it("extracts XLSX attachment cells into message context", async () => {
    const xlsx = await buildXlsxBase64();
    const parsed = await parseMessageWithAttachments(
      "Review this workbook",
      [
        {
          type: "document",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          fileName: "data.xlsx",
          content: xlsx,
        },
      ],
      { log: { warn: () => {} } },
    );
    expect(parsed.images).toHaveLength(0);
    expect(parsed.message).toContain("[Attached file: data.xlsx]");
    expect(parsed.message).toContain("A1:Hello");
    expect(parsed.message).toContain("B1:42");
  });
});
