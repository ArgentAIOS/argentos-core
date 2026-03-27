import { describe, expect, it } from "vitest";
import { CommandLane } from "../../process/lanes.js";
import { resolveGlobalLane } from "./lanes.js";

describe("resolveGlobalLane", () => {
  it("uses the explicit lane when provided", () => {
    expect(resolveGlobalLane(CommandLane.Background, { messageProvider: "webchat" })).toBe(
      CommandLane.Background,
    );
  });

  it("routes message-backed runs to the interactive lane by default", () => {
    expect(resolveGlobalLane(undefined, { messageProvider: "webchat" })).toBe(
      CommandLane.Interactive,
    );
    expect(resolveGlobalLane(undefined, { messageChannel: "whatsapp" })).toBe(
      CommandLane.Interactive,
    );
  });

  it("keeps non-message runs on the main lane by default", () => {
    expect(resolveGlobalLane()).toBe(CommandLane.Main);
  });
});
