import { vi } from "vitest";

export const connectOverCdpMock = vi.fn<(...args: unknown[]) => unknown>();
export const getChromeWebSocketUrlMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("playwright-core", () => ({
  chromium: {
    connectOverCDP: (...args: unknown[]) => connectOverCdpMock(...args),
  },
}));

vi.mock("./chrome.js", () => ({
  getChromeWebSocketUrl: (...args: unknown[]) => getChromeWebSocketUrlMock(...args),
}));
