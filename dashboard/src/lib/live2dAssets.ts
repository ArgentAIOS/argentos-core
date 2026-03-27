import { fetchLocalApi } from "../utils/localApiFetch";

export const LIVE2D_ASSET_BASE_PATH = "/live2d-assets";
export const LIVE2D_ASSET_STATUS_EVENT = "argent-live2d-assets-status";

export interface Live2dAssetStatus {
  installed: boolean;
  installing: boolean;
  version: string;
  assetBasePath: string;
  downloadUrl: string;
  installDir: string | null;
  sizeBytes: number;
  lastInstalledAt: string | null;
  lastError: string | null;
}

const DEFAULT_STATUS: Live2dAssetStatus = {
  installed: false,
  installing: false,
  version: "latest",
  assetBasePath: LIVE2D_ASSET_BASE_PATH,
  downloadUrl: "",
  installDir: null,
  sizeBytes: 0,
  lastInstalledAt: null,
  lastError: null,
};

export function getLive2dAssetPath(relativePath: string): string {
  const cleaned = relativePath.replace(/^\/+/, "");
  return `${LIVE2D_ASSET_BASE_PATH}/${cleaned}`;
}

export function normalizeLive2dModelPath(modelPath: string | null | undefined): string {
  const trimmed = typeof modelPath === "string" ? modelPath.trim() : "";
  if (!trimmed) {
    return getLive2dAssetPath("yiota/yiota.model3.json");
  }
  if (trimmed.startsWith(LIVE2D_ASSET_BASE_PATH)) {
    return trimmed;
  }
  if (trimmed.startsWith("/live2d/")) {
    return getLive2dAssetPath(trimmed.slice("/live2d/".length));
  }
  return trimmed;
}

export async function fetchLive2dAssetStatus(): Promise<Live2dAssetStatus> {
  const response = await fetchLocalApi("/api/live2d-assets/status");
  if (!response.ok) {
    throw new Error(`Failed to load Live2D asset status (${response.status})`);
  }
  const payload = (await response.json()) as Partial<Live2dAssetStatus>;
  return {
    ...DEFAULT_STATUS,
    ...payload,
    assetBasePath: payload.assetBasePath || LIVE2D_ASSET_BASE_PATH,
  };
}

export async function installLive2dAssets(): Promise<Live2dAssetStatus> {
  const response = await fetchLocalApi(
    "/api/live2d-assets/install",
    {
      method: "POST",
    },
    15 * 60_000,
  );
  if (!response.ok) {
    let message = `Failed to install Live2D assets (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        message = payload.error;
      }
    } catch {}
    throw new Error(message);
  }
  const payload = (await response.json()) as Partial<Live2dAssetStatus>;
  return {
    ...DEFAULT_STATUS,
    ...payload,
    assetBasePath: payload.assetBasePath || LIVE2D_ASSET_BASE_PATH,
  };
}

export function broadcastLive2dAssetStatus(status: Live2dAssetStatus) {
  window.dispatchEvent(
    new CustomEvent<Live2dAssetStatus>(LIVE2D_ASSET_STATUS_EVENT, {
      detail: status,
    }),
  );
}
