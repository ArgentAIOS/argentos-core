import { describe, expect, it } from "vitest";
import { classifyToolActivity } from "./aevp-tool-classify.js";

describe("classifyToolActivity", () => {
  it("classifies send_payload as communicate", () => {
    expect(classifyToolActivity("send_payload")).toBe("communicate");
  });

  it("classifies vip_email as communicate", () => {
    expect(classifyToolActivity("vip_email")).toBe("communicate");
  });

  it("classifies onboarding_pack as analyze", () => {
    expect(classifyToolActivity("onboarding_pack")).toBe("analyze");
  });
});
