import { describe, expect, it } from "vitest";
import { loadOptionalToolFactory } from "./optional-tool-factory.js";

describe("loadOptionalToolFactory", () => {
  it("returns null when an optional module is absent", () => {
    const factory = loadOptionalToolFactory("../../../definitely-missing-tool.js", "missing");
    expect(factory).toBeNull();
  });

  it("returns the requested export when the module exists", () => {
    const factory = loadOptionalToolFactory<() => { name: string }>(
      "./optional-tool-factory.fixture.js",
      "fixtureToolFactory",
    );

    expect(typeof factory).toBe("function");
    expect(factory?.()).toEqual({ name: "fixture-tool" });
  });
});
