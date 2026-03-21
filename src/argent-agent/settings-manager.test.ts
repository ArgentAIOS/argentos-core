import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ArgentSettingsManager } from "./settings-manager.js";

describe("ArgentSettingsManager", () => {
  let tempDir: string;
  let globalDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "argent-settings-test-"));
    globalDir = join(tempDir, "global");
    projectDir = join(tempDir, "project");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("create + defaults", () => {
    it("returns sensible defaults when no files exist", () => {
      const sm = ArgentSettingsManager.create(projectDir, globalDir);

      expect(sm.getCompactionEnabled()).toBe(true);
      expect(sm.getCompactionReserveTokens()).toBe(10_000);
      expect(sm.getRetryEnabled()).toBe(true);
      expect(sm.getSteeringMode()).toBe("all");
      expect(sm.getFollowUpMode()).toBe("all");
      expect(sm.getHideThinkingBlock()).toBe(false);
      expect(sm.getQuietStartup()).toBe(false);
      expect(sm.getEnableSkillCommands()).toBe(true);
      expect(sm.getDoubleEscapeAction()).toBe("fork");
    });
  });

  describe("inMemory", () => {
    it("works with initial settings", () => {
      const sm = ArgentSettingsManager.inMemory({
        defaultProvider: "anthropic",
        defaultModel: "claude-3-5-sonnet",
      });

      expect(sm.getDefaultProvider()).toBe("anthropic");
      expect(sm.getDefaultModel()).toBe("claude-3-5-sonnet");
    });
  });

  describe("persistence — global", () => {
    it("saves and reloads global settings", () => {
      const sm1 = ArgentSettingsManager.create(projectDir, globalDir);
      sm1.setDefaultProvider("openai");
      sm1.setDefaultModel("gpt-4o");
      sm1.setTheme("dark");

      // Reload
      const sm2 = ArgentSettingsManager.create(projectDir, globalDir);
      expect(sm2.getDefaultProvider()).toBe("openai");
      expect(sm2.getDefaultModel()).toBe("gpt-4o");
      expect(sm2.getTheme()).toBe("dark");
    });

    it("persists compaction overrides", () => {
      const sm1 = ArgentSettingsManager.create(projectDir, globalDir);
      sm1.setCompactionEnabled(false);

      const sm2 = ArgentSettingsManager.create(projectDir, globalDir);
      expect(sm2.getCompactionEnabled()).toBe(false);
    });
  });

  describe("two-layer merge", () => {
    it("project settings override global settings", () => {
      // Write global
      writeFileSync(
        join(globalDir, "settings.json"),
        JSON.stringify({ defaultProvider: "anthropic", theme: "light" }),
      );
      // Write project
      mkdirSync(join(projectDir, ".argentos"), { recursive: true });
      writeFileSync(
        join(projectDir, ".argentos", "settings.json"),
        JSON.stringify({ defaultProvider: "openai" }),
      );

      const sm = ArgentSettingsManager.create(projectDir, globalDir);
      expect(sm.getDefaultProvider()).toBe("openai"); // Project wins
      expect(sm.getTheme()).toBe("light"); // Falls through to global
    });
  });

  describe("runtime overrides", () => {
    it("applyOverrides takes highest precedence", () => {
      const sm = ArgentSettingsManager.create(projectDir, globalDir);
      sm.setCompactionEnabled(true);

      sm.applyOverrides({ compaction: { reserveTokens: 50_000 } });
      expect(sm.getCompactionReserveTokens()).toBe(50_000);

      // Reload clears runtime overrides implicitly (new instance)
      const sm2 = ArgentSettingsManager.create(projectDir, globalDir);
      expect(sm2.getCompactionReserveTokens()).toBe(10_000); // Back to default
    });

    it("deep merges nested objects", () => {
      const sm = ArgentSettingsManager.inMemory({
        compaction: { enabled: true, reserveTokens: 10_000, keepRecentTokens: 4_000 },
      });

      sm.applyOverrides({ compaction: { reserveTokens: 25_000 } });
      expect(sm.getCompactionEnabled()).toBe(true); // Preserved
      expect(sm.getCompactionReserveTokens()).toBe(25_000); // Overridden
      expect(sm.getCompactionKeepRecentTokens()).toBe(4_000); // Preserved
    });
  });

  describe("getters and setters", () => {
    it("model and provider", () => {
      const sm = ArgentSettingsManager.inMemory();
      sm.setDefaultModelAndProvider("google", "gemini-2.0-flash");
      expect(sm.getDefaultProvider()).toBe("google");
      expect(sm.getDefaultModel()).toBe("gemini-2.0-flash");
    });

    it("thinking level", () => {
      const sm = ArgentSettingsManager.inMemory();
      expect(sm.getDefaultThinkingLevel()).toBeUndefined();
      sm.setDefaultThinkingLevel("high");
      expect(sm.getDefaultThinkingLevel()).toBe("high");
    });

    it("retry settings", () => {
      const sm = ArgentSettingsManager.inMemory();
      const retry = sm.getRetrySettings();
      expect(retry.enabled).toBe(true);
      expect(retry.maxRetries).toBe(3);
      expect(retry.baseDelayMs).toBe(1_000);
      expect(retry.maxDelayMs).toBe(30_000);
    });

    it("shell settings", () => {
      const sm = ArgentSettingsManager.inMemory();
      sm.setShellPath("/usr/local/bin/zsh");
      sm.setShellCommandPrefix("TERM=xterm");
      expect(sm.getShellPath()).toBe("/usr/local/bin/zsh");
      expect(sm.getShellCommandPrefix()).toBe("TERM=xterm");
    });

    it("resource paths", () => {
      const sm = ArgentSettingsManager.inMemory();
      sm.setSkillPaths(["/path/to/skills"]);
      sm.setExtensionPaths(["/path/to/ext"]);
      expect(sm.getSkillPaths()).toEqual(["/path/to/skills"]);
      expect(sm.getExtensionPaths()).toEqual(["/path/to/ext"]);
    });

    it("image settings", () => {
      const sm = ArgentSettingsManager.inMemory();
      expect(sm.getImageAutoResize()).toBe(true);
      expect(sm.getBlockImages()).toBe(false);
      sm.setBlockImages(true);
      expect(sm.getBlockImages()).toBe(true);
    });

    it("enabled models", () => {
      const sm = ArgentSettingsManager.inMemory();
      expect(sm.getEnabledModels()).toBeUndefined();
      sm.setEnabledModels(["claude-*", "gpt-4*"]);
      expect(sm.getEnabledModels()).toEqual(["claude-*", "gpt-4*"]);
    });

    it("UI behavior", () => {
      const sm = ArgentSettingsManager.inMemory();
      expect(sm.getEditorPaddingX()).toBe(2);
      sm.setEditorPaddingX(4);
      expect(sm.getEditorPaddingX()).toBe(4);
      expect(sm.getAutocompleteMaxVisible()).toBe(10);
    });
  });

  describe("getGlobalSettings / getProjectSettings", () => {
    it("returns copies (not references)", () => {
      const sm = ArgentSettingsManager.inMemory({ defaultProvider: "test" });
      const global = sm.getGlobalSettings();
      global.defaultProvider = "mutated";
      expect(sm.getDefaultProvider()).toBe("test"); // Original unchanged
    });
  });
});
