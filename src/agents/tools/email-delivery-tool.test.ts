import { describe, expect, it } from "vitest";
import { createEmailDeliveryTool } from "./email-delivery-tool.js";

/**
 * Regression: the tool's catch-all returned failures as a PLAIN TEXT result,
 * so programmatic callers (the workflow runner's send_email executor) had no
 * error signal — an email to an empty recipient was logged as DELIVERED and
 * the run completed. Failures must carry details.ok=false.
 */
describe("email_delivery error contract", () => {
  it("failed send → structured details.ok=false with the error text", async () => {
    const tool = createEmailDeliveryTool();
    // Missing to/from/subject throws inside requireMessageFields before any
    // provider call, regardless of which API keys exist in the environment.
    const result = await tool.execute("t1", { action: "send_resend" });
    const details = result.details as Record<string, unknown>;
    expect(details.ok).toBe(false);
    expect(String(details.error)).toContain("email_delivery error:");
  });

  it("unknown action stays a plain text result (agent-facing help)", async () => {
    const tool = createEmailDeliveryTool();
    const result = await tool.execute("t2", { action: "send_carrier_pigeon" });
    expect(result.details).toBeUndefined();
    const first = (result.content as Array<{ text?: string }>)[0];
    expect(first?.text).toContain("Unknown action");
  });
});
