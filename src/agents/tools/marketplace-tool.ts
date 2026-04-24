import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import type { AnyAgentTool } from "./common.js";
import { resolvePackedRootDir } from "../../infra/archive.js";
import { installPluginFromArchive } from "../../plugins/install.js";
import { CONFIG_DIR } from "../../utils.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { readStringParam, readNumberParam } from "./common.js";

const MARKETPLACE_API = "https://marketplace.argentos.ai/api/v1";

const ACTIONS = ["search", "details", "install"] as const;

const MarketplaceToolSchema = Type.Object({
  action: optionalStringEnum(ACTIONS, {
    description:
      'Action: "search" (browse/search marketplace catalog), "details" (get package info), "install" (download and install a package). Defaults to "search".',
    default: "search",
  }),
  query: Type.Optional(
    Type.String({ description: "Search query for filtering packages (used with search action)." }),
  ),
  category: Type.Optional(
    Type.String({
      description:
        'Filter by category: "skills", "plugins", "connectors", "bundles", "avatars", "templates" (used with search action).',
    }),
  ),
  packageId: Type.Optional(
    Type.String({ description: "Package ID (used with details and install actions)." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Max results to return (default 20, used with search)." }),
  ),
});

function readLicenseKey(): string | null {
  const argentosDir = path.join(os.homedir(), ".argentos");
  try {
    const config = JSON.parse(fs.readFileSync(path.join(argentosDir, "argent.json"), "utf-8"));
    if (config.license?.key) {
      return config.license.key;
    }
  } catch {
    // no argent.json or no license block
  }
  try {
    const licenseFile = JSON.parse(
      fs.readFileSync(path.join(argentosDir, "license.json"), "utf-8"),
    );
    if (licenseFile.key) {
      return licenseFile.key;
    }
  } catch {
    // no license.json
  }
  return null;
}

async function marketplaceFetch(urlPath: string, licenseKey: string | null): Promise<Response> {
  const url = `${MARKETPLACE_API}${urlPath}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (licenseKey) {
    headers["X-License-Key"] = licenseKey;
  }
  return await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
}

interface CatalogItem {
  id: string;
  name: string;
  display_name: string;
  description: string;
  category: string;
  tags: string | string[];
  author_name: string;
  author_verified: boolean;
  latest_version: string;
  total_downloads: number;
  rating: number;
  pricing: string;
  listed: boolean;
}

interface CatalogSearchResult {
  items: CatalogItem[];
  total: number;
}

type MarketplacePackageRecord = Record<string, unknown>;

type ResolvedMarketplacePackage = {
  pkg: MarketplacePackageRecord;
  source: "details" | "search";
};

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function normalizeMatchText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function findCatalogMatch(items: CatalogItem[], ref: string): CatalogItem | null {
  const needle = normalizeMatchText(ref);
  if (!needle) {
    return null;
  }

  const exact = items.find((item) =>
    [item.id, item.name, item.display_name].some(
      (candidate) => normalizeMatchText(candidate) === needle,
    ),
  );
  if (exact) {
    return exact;
  }

  if (items.length === 1) {
    return items[0] ?? null;
  }

  return null;
}

function formatCatalogItem(item: CatalogItem): string {
  const tags =
    typeof item.tags === "string"
      ? (() => {
          try {
            return JSON.parse(item.tags);
          } catch {
            return [];
          }
        })()
      : item.tags;
  const lines: string[] = [];
  const badge = item.listed ? "" : " [ORG-PRIVATE]";
  const verified = item.author_verified ? " ✓" : "";
  lines.push(`${item.display_name}${badge}`);
  lines.push(`  ID: ${item.id}`);
  lines.push(`  Name: ${item.name}`);
  lines.push(
    `  Category: ${item.category} | Version: ${item.latest_version} | Pricing: ${item.pricing}`,
  );
  lines.push(`  Author: ${item.author_name}${verified}`);
  lines.push(`  Downloads: ${item.total_downloads} | Rating: ${item.rating}`);
  lines.push(`  ${item.description}`);
  if (Array.isArray(tags) && tags.length > 0) {
    lines.push(`  Tags: ${tags.join(", ")}`);
  }
  return lines.join("\n");
}

async function actionSearch(params: Record<string, unknown>) {
  const query = readStringParam(params, "query");
  const category = readStringParam(params, "category");
  const limit = readNumberParam(params, "limit", { integer: true }) ?? 20;
  const licenseKey = readLicenseKey();

  const data = await fetchCatalogSearch({ query: query ?? "", category, limit, licenseKey });
  const items = data.items || [];

  if (items.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No packages found matching your query." }],
      details: { ok: true, action: "search", count: 0, hasLicense: !!licenseKey },
    };
  }

  const formatted = items.map(formatCatalogItem).join("\n\n");
  const text = `Marketplace Results (${items.length} packages):\n\n${formatted}`;

  return {
    content: [{ type: "text" as const, text }],
    details: { ok: true, action: "search", count: items.length, hasLicense: !!licenseKey },
  };
}

async function actionDetails(params: Record<string, unknown>) {
  const packageId = readStringParam(params, "packageId", { required: true, label: "packageId" });
  const licenseKey = readLicenseKey();
  const resolved = await resolveMarketplacePackage(packageId, licenseKey);
  const pkg = resolved.pkg;
  const lines: string[] = [];
  lines.push(`Package: ${pkg.display_name || pkg.name}`);
  lines.push(`ID: ${pkg.id}`);
  lines.push(`Name: ${pkg.name}`);
  lines.push(`Category: ${pkg.category}`);
  lines.push(`Author: ${pkg.author_name}${pkg.author_verified ? " ✓" : ""}`);
  lines.push(`Version: ${pkg.latest_version}`);
  lines.push(`Pricing: ${pkg.pricing}`);
  lines.push(`Downloads: ${pkg.total_downloads}`);
  lines.push(`Rating: ${pkg.rating} (${pkg.rating_count} reviews)`);
  lines.push(`Description: ${pkg.description}`);

  const tags = pkg.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    lines.push(`Tags: ${tags.join(", ")}`);
  }

  if (resolved.source === "search") {
    lines.push("");
    lines.push("Marketplace details endpoint unavailable; showing catalog summary.");
  }

  const latest = pkg.latest as Record<string, unknown> | null;
  if (latest) {
    lines.push("");
    lines.push("Latest Version Details:");
    lines.push(`  Version: ${latest.version}`);
    if (latest.changelog) {
      lines.push(`  Changelog: ${latest.changelog}`);
    }
    if (latest.min_argent_version) {
      lines.push(`  Min ArgentOS: ${latest.min_argent_version}`);
    }
    const tools = latest.tools as string[] | null;
    if (Array.isArray(tools) && tools.length > 0) {
      lines.push(`  Tools: ${tools.join(", ")}`);
    }
    const permissions = latest.permissions as string[] | null;
    if (Array.isArray(permissions) && permissions.length > 0) {
      lines.push(`  Permissions: ${permissions.join(", ")}`);
    }
  }

  lines.push(`\nVersions available: ${pkg.version_count}`);

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: { ok: true, action: "details", packageId, name: pkg.name },
  };
}

async function actionInstall(params: Record<string, unknown>) {
  const packageId = readStringParam(params, "packageId", { required: true, label: "packageId" });
  const licenseKey = readLicenseKey();

  const resolved = await resolveMarketplacePackage(packageId, licenseKey);
  const pkg = resolved.pkg;
  const resolvedPackageId =
    readStringParam(pkg, "id", { required: false, label: "package id" }) ?? packageId;

  // Download the package archive
  const downloadUrl = `${MARKETPLACE_API}/catalog/${encodeURIComponent(resolvedPackageId)}/download`;
  const headers: Record<string, string> = {};
  if (licenseKey) {
    headers["X-License-Key"] = licenseKey;
  }

  const downloadRes = await fetch(downloadUrl, {
    headers,
    signal: AbortSignal.timeout(120_000),
  });

  if (!downloadRes.ok) {
    const errorBody = await downloadRes.text().catch(() => "");
    if (downloadRes.status === 402) {
      throw new Error(`License required to download this package. ${errorBody}`);
    }
    throw new Error(`Download failed (${downloadRes.status}): ${errorBody}`);
  }

  // Save to temp file
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "argent-marketplace-"));
  const archiveName = `${pkg.name || packageId}.tgz`;
  const archivePath = path.join(tmpDir, archiveName);
  const body = downloadRes.body;
  if (!body) {
    throw new Error("Download returned empty body");
  }

  // Write the response body to file
  const arrayBuffer = await downloadRes.arrayBuffer();
  await fsp.writeFile(archivePath, Buffer.from(arrayBuffer));

  // Extract to temp dir to inspect package format
  const extractDir = path.join(tmpDir, "extract");
  await fsp.mkdir(extractDir, { recursive: true });

  // Extract the .tgz
  const tarBuffer = await fsp.readFile(archivePath);
  await extractTgz(tarBuffer, extractDir);
  const packageRoot = await resolvePackedRootDir(extractDir);

  // Detect package format
  const hasPluginJson = fs.existsSync(path.join(packageRoot, "argent.plugin.json"));
  const hasPackageJson = fs.existsSync(path.join(packageRoot, "package.json"));
  const hasSkillsDir = fs.existsSync(path.join(packageRoot, "skills"));
  const connectorDirs = await findMarketplaceConnectorDirs(packageRoot, pkg);

  let installResult: { ok: boolean; message: string; installed: string[] };

  if (connectorDirs.length > 0) {
    installResult = await installMarketplaceConnectorPackage(connectorDirs);
  } else if (hasPluginJson || hasSkillsDir) {
    // Marketplace skill package format: argent.plugin.json + skills/ directory
    installResult = await installMarketplaceSkillPackage(packageRoot);
  } else if (hasPackageJson) {
    // Legacy plugin format: package.json with argent.extensions
    const result = await installPluginFromArchive({
      archivePath,
      timeoutMs: 120_000,
      logger: {
        info: (msg) => console.log(`[marketplace-install] ${msg}`),
        warn: (msg) => console.warn(`[marketplace-install] ${msg}`),
      },
      mode: "install",
    });
    installResult = result.ok
      ? {
          ok: true,
          message: `Installed plugin ${result.pluginId} to ${result.targetDir}`,
          installed: result.extensions,
        }
      : { ok: false, message: result.error, installed: [] };
  } else {
    installResult = {
      ok: false,
      message: "Package has no argent.plugin.json or package.json — unknown format",
      installed: [],
    };
  }

  // Cleanup temp
  await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);

  if (!installResult.ok) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to install ${pkg.display_name || pkg.name}: ${installResult.message}`,
        },
      ],
      details: { ok: false, action: "install", packageId, error: installResult.message },
    };
  }

  const lines: string[] = [];
  lines.push(`Successfully installed ${pkg.display_name || pkg.name}!`);
  lines.push(`  ${installResult.message}`);
  if (installResult.installed.length > 0) {
    lines.push(`  Installed: ${installResult.installed.join(", ")}`);
  }
  lines.push("");
  lines.push("Skills are available immediately. Connectors and plugins require a gateway restart.");

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: {
      ok: true,
      action: "install",
      packageId,
      name: pkg.name,
      installed: installResult.installed,
    },
  };
}

async function fetchCatalogSearch(params: {
  query: string;
  category?: string;
  limit: number;
  licenseKey: string | null;
}): Promise<CatalogSearchResult> {
  const searchParams = new URLSearchParams();
  if (params.query) {
    searchParams.set("q", params.query);
  }
  if (params.category) {
    searchParams.set("category", params.category);
  }
  searchParams.set("limit", String(Math.min(params.limit, 50)));

  const endpoint = params.licenseKey
    ? `/catalog/licensed?key=${encodeURIComponent(params.licenseKey)}&${searchParams.toString()}`
    : `/catalog?${searchParams.toString()}`;

  const res = await marketplaceFetch(endpoint, params.licenseKey);
  if (!res.ok) {
    throw new Error(`Marketplace API returned ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as CatalogSearchResult;
}

async function resolveMarketplacePackage(
  packageRef: string,
  licenseKey: string | null,
): Promise<ResolvedMarketplacePackage> {
  const normalizedRef = packageRef.trim();
  if (!normalizedRef) {
    throw new Error("packageId required");
  }

  const trySearch = async (): Promise<ResolvedMarketplacePackage | null> => {
    const data = await fetchCatalogSearch({
      query: normalizedRef,
      category: undefined,
      limit: 20,
      licenseKey,
    });
    const match = findCatalogMatch(data.items || [], normalizedRef);
    if (!match) {
      return null;
    }
    return { pkg: match as MarketplacePackageRecord, source: "search" };
  };

  if (isUuidLike(normalizedRef)) {
    const detailsRes = await marketplaceFetch(
      `/catalog/${encodeURIComponent(normalizedRef)}`,
      licenseKey,
    );
    if (detailsRes.ok) {
      return { pkg: (await detailsRes.json()) as MarketplacePackageRecord, source: "details" };
    }
    const fallback = await trySearch();
    if (fallback) {
      return fallback;
    }
    throw new Error(`Marketplace API returned ${detailsRes.status}: ${await detailsRes.text()}`);
  }

  const searchResult = await trySearch();
  if (searchResult) {
    return searchResult;
  }

  const detailsRes = await marketplaceFetch(
    `/catalog/${encodeURIComponent(normalizedRef)}`,
    licenseKey,
  );
  if (detailsRes.ok) {
    return { pkg: (await detailsRes.json()) as MarketplacePackageRecord, source: "details" };
  }

  throw new Error(`Package not found: ${normalizedRef}`);
}

/**
 * Extract a .tgz (gzipped tar) buffer into a directory.
 */
async function extractTgz(buffer: Buffer, destDir: string): Promise<void> {
  // Decompress gzip
  const decompressed = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gunzip = createGunzip();
    const readable = Readable.from(buffer);
    readable
      .pipe(gunzip)
      .on("data", (chunk: Buffer) => chunks.push(chunk))
      .on("end", () => resolve(Buffer.concat(chunks)))
      .on("error", reject);
  });

  // Parse tar
  let offset = 0;
  while (offset < decompressed.length - 512) {
    const header = decompressed.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      break;
    }

    const nameEnd = header.indexOf(0, 0);
    const name = header.subarray(0, Math.min(nameEnd, 100)).toString("utf-8");
    const sizeStr = header.subarray(124, 136).toString("utf-8").trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = header[156];

    offset += 512;

    if (name && !path.isAbsolute(name) && !name.split(/[\\/]+/).includes("..")) {
      const fullPath = path.resolve(destDir, name);
      if (!fullPath.startsWith(path.resolve(destDir) + path.sep)) {
        offset += Math.ceil(size / 512) * 512;
        continue;
      }
      if (typeFlag === 53 || name.endsWith("/")) {
        // Directory
        await fsp.mkdir(fullPath, { recursive: true });
      } else if (typeFlag === 0 || typeFlag === 48) {
        // Regular file
        await fsp.mkdir(path.dirname(fullPath), { recursive: true });
        await fsp.writeFile(fullPath, decompressed.subarray(offset, offset + size));
      }
    }

    offset += Math.ceil(size / 512) * 512;
  }
}

/**
 * Install a marketplace skill package (argent.plugin.json format).
 * Copies skill directories into ~/.argentos/skills/
 */
async function installMarketplaceSkillPackage(
  packageRoot: string,
): Promise<{ ok: boolean; message: string; installed: string[] }> {
  const skillsTarget = path.join(CONFIG_DIR, "skills");
  await fsp.mkdir(skillsTarget, { recursive: true });

  const installed: string[] = [];

  // Find skill directories to install
  const skillsSourceDir = path.join(packageRoot, "skills");
  if (fs.existsSync(skillsSourceDir)) {
    const entries = await fsp.readdir(skillsSourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const srcSkillDir = path.join(skillsSourceDir, entry.name);
        const destSkillDir = path.join(skillsTarget, entry.name);

        // Check for SKILL.md to validate it's a real skill
        const skillMd = path.join(srcSkillDir, "SKILL.md");
        if (!fs.existsSync(skillMd)) {
          continue;
        }

        // Copy skill directory
        if (fs.existsSync(destSkillDir)) {
          // Update: remove old, copy new
          await fsp.rm(destSkillDir, { recursive: true, force: true });
        }
        await fsp.cp(srcSkillDir, destSkillDir, { recursive: true });
        installed.push(entry.name);
      }
    }
  }

  if (installed.length === 0) {
    return {
      ok: false,
      message: "No valid skills found in package (missing SKILL.md)",
      installed: [],
    };
  }

  return {
    ok: true,
    message: `Installed ${installed.length} skill(s) to ${skillsTarget}`,
    installed,
  };
}

async function findMarketplaceConnectorDirs(
  packageRoot: string,
  pkg: Record<string, unknown>,
): Promise<string[]> {
  const candidates = [
    packageRoot,
    path.join(packageRoot, "connector"),
    path.join(packageRoot, "connectors"),
    path.join(packageRoot, "tools", "aos"),
  ];
  const pkgName = readStringParam(pkg, "name") ?? "";
  if (pkgName.startsWith("aos-")) {
    candidates.push(path.join(packageRoot, pkgName));
  }

  const connectorDirs: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const stat = await fsp.stat(candidate).catch(() => null);
    if (!stat?.isDirectory()) {
      continue;
    }
    if (fs.existsSync(path.join(candidate, "connector.json"))) {
      const resolved = path.resolve(candidate);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        connectorDirs.push(resolved);
      }
      continue;
    }
    const entries = await fsp.readdir(candidate, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("aos-")) {
        continue;
      }
      const dir = path.join(candidate, entry.name);
      if (!fs.existsSync(path.join(dir, "connector.json"))) {
        continue;
      }
      const resolved = path.resolve(dir);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        connectorDirs.push(resolved);
      }
    }
  }
  return connectorDirs;
}

async function installMarketplaceConnectorPackage(
  connectorDirs: string[],
): Promise<{ ok: boolean; message: string; installed: string[] }> {
  const connectorsTarget = path.join(CONFIG_DIR, "connectors");
  await fsp.mkdir(connectorsTarget, { recursive: true });

  const installed: string[] = [];
  for (const srcConnectorDir of connectorDirs) {
    const connectorName = path.basename(srcConnectorDir);
    if (!connectorName.startsWith("aos-")) {
      continue;
    }
    const destConnectorDir = path.join(connectorsTarget, connectorName);
    if (fs.existsSync(destConnectorDir)) {
      await fsp.rm(destConnectorDir, { recursive: true, force: true });
    }
    await fsp.cp(srcConnectorDir, destConnectorDir, { recursive: true });
    installed.push(connectorName);
  }

  if (installed.length === 0) {
    return {
      ok: false,
      message: "No valid connectors found in package (missing aos-* connector.json directory)",
      installed: [],
    };
  }

  return {
    ok: true,
    message: `Installed ${installed.length} connector(s) to ${connectorsTarget}`,
    installed,
  };
}

export function createMarketplaceTool(): AnyAgentTool {
  return {
    label: "Marketplace",
    name: "marketplace",
    description:
      "Browse, search, and install packages from the ArgentOS Marketplace. " +
      'Use action="search" to browse available skills, connectors, plugins, and extensions. ' +
      'Use action="details" to get full info about a specific package. ' +
      'Use action="install" to download and install a package. ' +
      "Requires a valid ArgentOS license for org-private packages and paid downloads.",
    parameters: MarketplaceToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action") ?? "search";

      switch (action) {
        case "search":
          return await actionSearch(params);
        case "details":
          return await actionDetails(params);
        case "install":
          return await actionInstall(params);
        default:
          throw new Error(`Unknown action: ${action}. Use "search", "details", or "install".`);
      }
    },
  };
}
