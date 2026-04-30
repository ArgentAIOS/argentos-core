import { describe, expect, it } from "vitest";
import {
  connectorCommandExtraArgToCliArg,
  connectorCommandToCliArgs,
} from "../../infra/workflow-connector-command.js";

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

  it("stringifies connector command arguments without object toString output", () => {
    expect(connectorCommandExtraArgToCliArg("hello")).toBe("hello");
    expect(connectorCommandExtraArgToCliArg(3)).toBe("3");
    expect(connectorCommandExtraArgToCliArg({ dryRun: true })).toBe('{"dryRun":true}');
    expect(connectorCommandExtraArgToCliArg(undefined)).toBeUndefined();
  });
});
