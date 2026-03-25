import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("public core denylist", () => {
  it("blocks internal doc trees and translations from the public core mirror", () => {
    const denylistPath = path.join(process.cwd(), "docs", "argent", "public-core-denylist.json");
    const raw = readFileSync(denylistPath, "utf8");
    const parsed = JSON.parse(raw) as {
      rules: Array<{ id: string; paths: string[] }>;
    };

    const docRule = parsed.rules.find((rule) => rule.id === "internal-doc-trees-and-translations");
    expect(docRule?.paths).toEqual(
      expect.arrayContaining([
        "docs/argent/**",
        "docs/zh-CN/**",
        "docs/sprint-locks/**",
        "docs/the-awakening/**",
        "docs/refactor/**",
      ]),
    );
  });
});
