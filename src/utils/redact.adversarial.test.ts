import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "./redact.js";

describe("redactSensitiveText adversarial coverage", () => {
  it("redacts multiple secret formats in one payload", () => {
    const input = [
      "OPENAI_API_KEY=sk-1234567890abcdefghijklmnop",
      "Authorization: Bearer ghp_1234567890abcdefghij",
      '{"secret_value":"rk_live_1234567890abcdefghijkl"}',
      "postgres://worker:supersecretpassword@db.internal/argentos",
    ].join("\n");

    const output = redactSensitiveText(input);

    expect(output).not.toContain("supersecretpassword");
    expect(output).not.toContain("ghp_1234567890abcdefghij");
    expect(output).not.toContain("rk_live_1234567890abcdefghijkl");
    expect(output).toContain("OPENAI_API_KEY=***");
    expect(output).toContain("Authorization: Bearer ***");
    expect(output).toContain('"secret_value": "***"');
    expect(output).toContain("postgres://worker:***@db.internal/argentos");
  });

  it("fully redacts short secret assignments while leaving benign nearby text", () => {
    const input = "TOKEN=shortvalue\nstatus=ok\nPASSWORD=hunter2";
    const output = redactSensitiveText(input);

    expect(output).toContain("TOKEN=***");
    expect(output).toContain("PASSWORD=***");
    expect(output).toContain("status=ok");
  });
});
