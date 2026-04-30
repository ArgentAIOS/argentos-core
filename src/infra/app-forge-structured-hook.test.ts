import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForgeApp } from "../../dashboard/src/hooks/useApps";
import { act, createElement, useEffect } from "../../dashboard/node_modules/react";
import { createRoot } from "../../dashboard/node_modules/react-dom/client";
import {
  type GatewayRequestFn,
  type useForgeStructuredData as useForgeStructuredDataType,
  useForgeStructuredData,
} from "../../dashboard/src/hooks/useForgeStructuredData";

type StructuredDataResult = ReturnType<typeof useForgeStructuredDataType>;
type StructuredDataProps = Parameters<typeof useForgeStructuredData>[0];

class FakeXMLHttpRequest {
  static latest: FakeXMLHttpRequest | null = null;

  method = "";
  url = "";
  timeout = 0;
  body: Document | XMLHttpRequestBodyInit | null = null;
  responseText = JSON.stringify({ app: app() });
  status = 200;
  statusText = "OK";
  private readonly headers = new Map<string, string>();
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor() {
    FakeXMLHttpRequest.latest = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string): void {
    this.headers.set(key.toLowerCase(), value);
  }

  getRequestHeader(key: string): string | undefined {
    return this.headers.get(key.toLowerCase());
  }

  getAllResponseHeaders(): string {
    return "content-type: application/json\r\n";
  }

  addEventListener(event: string, listener: () => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.body = body ?? null;
    queueMicrotask(() => this.listeners.get("load")?.forEach((listener) => listener()));
  }
}

function app(overrides: Partial<ForgeApp> = {}): ForgeApp {
  return {
    id: "app-1",
    name: "Campaign Review",
    description: "Review queue",
    icon: "",
    code: "<html></html>",
    creator: "ai",
    version: 1,
    createdAt: "2026-04-25T20:00:00.000Z",
    updatedAt: "2026-04-25T20:00:00.000Z",
    openCount: 0,
    pinned: false,
    metadata: {},
    ...overrides,
  };
}

function installDom(search = ""): HTMLDivElement {
  const { document, window } = parseHTML(
    '<!doctype html><html><body><div id="root"></div></body></html>',
  );
  const storage = new Map<string, string>();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(globalThis, {
    document,
    window: Object.assign(window, {
      XMLHttpRequest: FakeXMLHttpRequest,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      location: { hostname: "127.0.0.1", search },
    }),
  });
  return document.getElementById("root") as HTMLDivElement;
}

function HookHarness({
  onResult,
  props,
}: {
  onResult: (result: StructuredDataResult) => void;
  props: StructuredDataProps;
}) {
  const result = useForgeStructuredData(props);
  useEffect(() => onResult(result), [onResult, result]);
  onResult(result);
  return null;
}

describe("useForgeStructuredData", () => {
  let root: { render: (node: unknown) => void; unmount: () => void } | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    FakeXMLHttpRequest.latest = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("saves metadata through the same-origin browser-safe route when gateway and workflow events fail", async () => {
    const host = installDom("?token=secret-token");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const gatewayRequest: GatewayRequestFn = vi.fn(async () => {
      throw new Error("Not connected to Gateway");
    });
    const emitWorkflowEvent = vi.fn(async () => {
      throw new Error("signal is aborted without reason");
    });
    const fetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    let result: StructuredDataResult | null = null;
    root = createRoot(host);
    await act(async () => {
      root?.render(
        createElement(HookHarness, {
          onResult: (nextResult) => {
            result = nextResult;
          },
          props: {
            apps: [app()],
            selectedAppId: "app-1",
            onSelectApp: vi.fn(),
            gatewayRequest,
            emitWorkflowEvent,
          },
        }),
      );
    });

    if (!result) {
      throw new Error("hook result did not render");
    }
    const rendered = result as StructuredDataResult;
    await act(async () => {
      await rendered.addRecord();
    });
    await act(async () => {});
    const saved = result as StructuredDataResult;

    expect(saved.saveStatus).toMatchObject({
      kind: "degraded",
      message: "Saved to metadata fallback",
    });
    expect(saved.error).toBeNull();
    expect(saved.activeTable?.records).toHaveLength(6);
    expect(fetch).toHaveBeenCalledWith(
      "/api/apps/app-1/appforge-metadata",
      expect.objectContaining({
        body: expect.stringContaining('"metadata"'),
        method: "POST",
      }),
    );
    const fetchInit = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(fetchInit?.headers);
    expect(headers.get("authorization")).toBe("Bearer secret-token");
    expect(headers.get("content-type")).toBe("text/plain;charset=UTF-8");
    expect(FakeXMLHttpRequest.latest).toBeNull();
    expect(emitWorkflowEvent).toHaveBeenCalledOnce();
  });
});
