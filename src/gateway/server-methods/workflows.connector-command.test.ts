import { describe, expect, it } from "vitest";
import { connectorCommandToCliArgs } from "./workflows.js";

describe("connectorCommandToCliArgs", () => {
  it("splits manifest command ids into Click group/subcommand argv", () => {
    expect(connectorCommandToCliArgs("board.list")).toEqual(["board", "list"]);
    expect(connectorCommandToCliArgs("invoice.create_draft")).toEqual(["invoice", "create_draft"]);
  });

  it("keeps top-level connector commands as a single argv token", () => {
    expect(connectorCommandToCliArgs("health")).toEqual(["health"]);
    expect(connectorCommandToCliArgs("capabilities")).toEqual(["capabilities"]);
  });

  it("accepts explicit argv strings for hand-authored calls", () => {
    expect(connectorCommandToCliArgs("config show")).toEqual(["config", "show"]);
  });
});
