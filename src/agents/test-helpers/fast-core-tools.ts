import { vi } from "vitest";

const stubTool = (name: string) => ({
  name,
  description: `${name} stub`,
  parameters: { type: "object", properties: {} },
  execute: vi.fn(),
});

vi.mock("../tools/browser-tool.js", () => ({
  createBrowserTool: () => stubTool("browser"),
}));

vi.mock("../tools/canvas-tool.js", () => ({
  createCanvasTool: () => stubTool("canvas"),
}));

vi.mock("../tools/image-tool.js", () => ({
  createImageTool: () => stubTool("image"),
}));

vi.mock("../tools/web-tools.js", () => ({
  createWebSearchTool: () => null,
  createWebFetchTool: () => null,
}));

vi.mock("../tools/tinyfish-browser.js", () => ({
  createTinyFishBrowserOpenTool: () => stubTool("tinyfish_browser_open"),
  createTinyFishBrowserCloseTool: () => stubTool("tinyfish_browser_close"),
}));

vi.mock("../../plugins/tools.js", () => ({
  resolvePluginTools: () => [],
  getPluginToolMeta: () => undefined,
}));
