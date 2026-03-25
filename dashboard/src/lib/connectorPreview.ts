import { fetchLocalApi } from "../utils/localApiFetch";

type ConnectorPreviewPrimitive = string | number | boolean;

export type ConnectorPreviewRequest = {
  commandId: string;
  positional?: string[];
  options?: Record<string, ConnectorPreviewPrimitive>;
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type ConnectorPreviewResponse = {
  ok: boolean;
  tool: string;
  commandId: string;
  data?: unknown;
  envelope?: unknown;
  error?: string;
  details?: string;
};

export async function runConnectorPreview(
  tool: string,
  request: ConnectorPreviewRequest,
  timeoutMs = 20_000,
): Promise<ConnectorPreviewResponse> {
  const response = await fetchLocalApi(
    `/api/settings/connectors/${encodeURIComponent(tool)}/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    timeoutMs,
  );
  const payload = (await response.json().catch(() => ({}))) as ConnectorPreviewResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.details || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}
