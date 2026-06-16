import { describe, expect, it, vi } from "vitest";
import { telegramPlugin } from "./channel.js";

// Regression guard for the cron-approval-buttons fix: the registered telegram
// plugin's outbound MUST implement sendPayload so deliver.ts routes
// channelData.telegram.buttons through sendMessageTelegram's reply_markup path.
// Before this, the extension outbound had only sendText/sendMedia, so workflow
// approvals arrived as plain text with no Approve/Deny buttons.

describe("telegramPlugin.outbound.sendPayload", () => {
  it("is implemented (without it, deliver.ts drops inline keyboards)", () => {
    expect(typeof telegramPlugin.outbound?.sendPayload).toBe("function");
  });

  it("forwards channelData.telegram.buttons to the send call as reply_markup buttons", async () => {
    const send = vi.fn(async () => ({ messageId: "42", chatId: "8693117634" }));
    const buttons = [
      [
        { text: "✅ Approve", callback_data: "wf_app:approval-1" },
        { text: "❌ Deny", callback_data: "wf_dny:approval-1" },
      ],
    ];

    const result = await telegramPlugin.outbound!.sendPayload!({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cfg: {} as any,
      to: "8693117634",
      text: "Approve send email?",
      accountId: undefined,
      deps: { sendTelegram: send },
      payload: {
        text: "Approve send email?",
        channelData: { telegram: { buttons } },
      },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      "8693117634",
      "Approve send email?",
      expect.objectContaining({ buttons }),
    );
    expect(result).toMatchObject({ channel: "telegram", messageId: "42" });
  });

  it("omits buttons when no channelData is present", async () => {
    const send = vi.fn(async () => ({ messageId: "7", chatId: "1" }));
    await telegramPlugin.outbound!.sendPayload!({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cfg: {} as any,
      to: "1",
      text: "plain",
      deps: { sendTelegram: send },
      payload: { text: "plain" },
    });
    expect(send).toHaveBeenCalledWith(
      "1",
      "plain",
      expect.objectContaining({ buttons: undefined }),
    );
  });
});
