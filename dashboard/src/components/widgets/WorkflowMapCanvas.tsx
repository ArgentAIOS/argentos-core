/**
 * WorkflowMapCanvas — Live Workflow Map HUD
 *
 * Argent at center with thick cyan orbital rings.
 * Providers in upper arc, family agents in lower arc.
 * Each agent has a unique visual motif. Everything animates.
 * Matches the V3 Mission Control reference design.
 */

import { useRef, useEffect, useCallback, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────

interface AgentNode {
  id: string;
  name: string;
  role: string;
  color: string;
  status: "active" | "idle" | "error";
  currentTask?: string;
  provider?: string;
}

interface ProviderNode {
  id: string;
  name: string;
  status: "active" | "standby" | "error";
  color: string;
  model?: string;
}

interface WorkflowMapProps {
  agentName?: string;
  connected?: boolean;
  agentStatus?: string;
  gatewayRequest?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  /** Pre-loaded providers from parent (avoids cross-origin fetch issues in Swift wrapper) */
  initialProviders?: ProviderNode[];
  /** Pre-loaded agents from parent */
  initialAgents?: Array<AgentNode & { team?: string }>;
}

// ── Colors ────────────────────────────────────────────────────────

const C = {
  bg: "#060a10",
  nucleus: "#00AAFF",
  nucleusGlow: "rgba(0, 170, 255, 0.12)",
  ring: "rgba(0, 200, 255, 0.35)",
  ringDash: "rgba(0, 200, 255, 0.6)",
  connectionActive: "#00ffcc",
  connectionIdle: "rgba(100, 140, 180, 0.2)",
  connectionError: "#ff3d57",
  text: "#e0e8f0",
  textDim: "#667788",
  hudLabel: "#00aaff",
};

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "Codex",
  google: "Google",
  "google-gemini-cli": "Gemini",
  nvidia: "NVIDIA",
  ollama: "Ollama",
  xai: "xAI",
  zai: "Z.AI",
  minimax: "MiniMax",
  deepseek: "DeepSeek",
  groq: "Groq",
  openrouter: "OpenRouter",
  perplexity: "Perplexity",
  codestral: "Codestral",
  huggingface: "HuggingFace",
  lmstudio: "LM Studio",
  vllm: "vLLM",
  inception: "Inception",
  langchain: "LangChain",
};

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#c084fc",
  openai: "#ffab00",
  "openai-codex": "#ffab00",
  google: "#4285f4",
  "google-gemini-cli": "#4285f4",
  nvidia: "#76b900",
  ollama: "#00ffcc",
  xai: "#e0e0e0",
  zai: "#60a5fa",
  minimax: "#ff6b6b",
  deepseek: "#1a73e8",
  groq: "#f97316",
  openrouter: "#a855f7",
  perplexity: "#22d3ee",
  codestral: "#ff6b9d",
  huggingface: "#fbbf24",
  lmstudio: "#34d399",
  vllm: "#38bdf8",
  inception: "#fb923c",
  langchain: "#4ade80",
};

// ── Helpers ───────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r
    ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) }
    : { r: 0, g: 170, b: 255 };
}

interface Star {
  x: number;
  y: number;
  size: number;
  brightness: number;
  speed: number;
  offset: number;
}

function makeStars(n: number, w: number, h: number): Star[] {
  return Array.from({ length: n }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    size: Math.random() * 1.2 + 0.3,
    brightness: Math.random() * 0.4 + 0.2,
    speed: Math.random() * 0.002 + 0.001,
    offset: Math.random() * Math.PI * 2,
  }));
}

// ── Agent motif drawing functions ─────────────────────────────────

function drawReticle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  const rgb = hexToRgb(color);
  ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.7)`;
  ctx.lineWidth = 1.5;
  // Cross
  ctx.beginPath();
  ctx.moveTo(x - r * 0.6, y);
  ctx.lineTo(x + r * 0.6, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.6);
  ctx.lineTo(x, y + r * 0.6);
  ctx.stroke();
  // Circle
  ctx.beginPath();
  ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  // Dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function drawSunburst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  t: number,
) {
  const rgb = hexToRgb(color);
  ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.6)`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + t * 0.001;
    const inner = r * 0.25;
    const outer = r * (0.45 + Math.sin(t * 0.003 + i) * 0.1);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
    ctx.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.15, 0, Math.PI * 2);
  ctx.fill();
}

function drawHexagon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  const rgb = hexToRgb(color);
  ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.7)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
    const px = x + Math.cos(a) * r * 0.45;
    const py = y + Math.sin(a) * r * 0.45;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  const rgb = hexToRgb(color);
  ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.7)`;
  ctx.lineWidth = 1.5;
  const s = r * 0.45;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.stroke();
  // Inner diamond
  const si = r * 0.2;
  ctx.beginPath();
  ctx.moveTo(x, y - si);
  ctx.lineTo(x + si, y);
  ctx.lineTo(x, y + si);
  ctx.lineTo(x - si, y);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
}

function drawOrbitalRings(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  t: number,
) {
  const rgb = hexToRgb(color);
  ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.5)`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 0.0008 + (i * Math.PI) / 3);
    ctx.scale(1, 0.4);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  const rgb = hexToRgb(color);
  ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.7)`;
  ctx.lineWidth = 1.5;
  // Outer circle
  ctx.beginPath();
  ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
  ctx.stroke();
  // Inner circle
  ctx.beginPath();
  ctx.arc(x, y, r * 0.25, 0, Math.PI * 2);
  ctx.stroke();
  // Cross lines (broken)
  const gap = r * 0.15;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.55, y);
  ctx.lineTo(x - gap, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + gap, y);
  ctx.lineTo(x + r * 0.55, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.55);
  ctx.lineTo(x, y - gap);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y + gap);
  ctx.lineTo(x, y + r * 0.55);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

const MOTIFS = [
  drawReticle,
  drawSunburst,
  drawHexagon,
  drawDiamond,
  drawOrbitalRings,
  drawCrosshair,
];

// Draw bracket borders around a node [ ]
function drawBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const s = size + 6;
  const l = 8;
  ctx.strokeStyle = "rgba(100, 150, 200, 0.4)";
  ctx.lineWidth = 1;
  // Top-left
  ctx.beginPath();
  ctx.moveTo(x - s, y - s + l);
  ctx.lineTo(x - s, y - s);
  ctx.lineTo(x - s + l, y - s);
  ctx.stroke();
  // Top-right
  ctx.beginPath();
  ctx.moveTo(x + s - l, y - s);
  ctx.lineTo(x + s, y - s);
  ctx.lineTo(x + s, y - s + l);
  ctx.stroke();
  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(x - s, y + s - l);
  ctx.lineTo(x - s, y + s);
  ctx.lineTo(x - s + l, y + s);
  ctx.stroke();
  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(x + s - l, y + s);
  ctx.lineTo(x + s, y + s);
  ctx.lineTo(x + s, y + s - l);
  ctx.stroke();
}

// ── Agent filtering & team normalization ─────────────────────────

const EXCLUDED_AGENT_IDS = new Set(["dumbo", "argent"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/** Filter out non-operational agents (think tank, test, system internals) */
function isOperationalAgent(a: { id: string; role?: string; name?: string }): boolean {
  if (EXCLUDED_AGENT_IDS.has(a.id.toLowerCase())) return false;
  if (a.id.startsWith("test-")) return false;
  if (UUID_RE.test(a.id)) return false;
  if (a.role === "think_tank_panelist") return false;
  if (!a.role) return false;
  return true;
}

/** Normalize team names — merge variants into clean clusters */
function normalizeTeam(team: string): string {
  const t = team.toLowerCase().trim();
  if (t === "think-tank") return "__skip__";
  if (t === "unassigned" || t === "") return "core";
  if (t.includes("support") || t === "msp team" || t === "msp-team") return "support";
  if (t.includes("office")) return "office";
  if (t === "dev-team" || t === "development") return "dev-team";
  if (t === "marketing-team" || t === "marketing") return "marketing";
  return team;
}

const TEAM_DISPLAY_NAMES: Record<string, string> = {
  core: "Core",
  "dev-team": "Development",
  marketing: "Marketing",
  support: "Support",
  office: "Office",
};

// ── Component ─────────────────────────────────────────────────────

export function WorkflowMapCanvas({
  agentName = "Argent",
  connected = false,
  agentStatus = "Offline",
  gatewayRequest,
  initialProviders,
  initialAgents,
}: WorkflowMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const starsRef = useRef<Star[]>([]);
  const timeRef = useRef(0);
  const cssSizeRef = useRef({ w: 800, h: 600 });
  const clickTargetsRef = useRef<Array<{ x: number; y: number; r: number; team: string }>>([]);

  const [providers, setProviders] = useState<ProviderNode[]>(initialProviders || []);
  const [agents, setAgents] = useState<AgentNode[]>(initialAgents || []);

  // Use initial data from props when available (avoids cross-origin fetch in Swift wrapper)
  useEffect(() => {
    if (initialProviders && initialProviders.length > 0) setProviders(initialProviders);
  }, [initialProviders]);
  useEffect(() => {
    if (initialAgents && initialAgents.length > 0) setAgents(initialAgents);
  }, [initialAgents]);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  // Group agents by normalized team for cluster view
  const teams = agents.reduce(
    (acc, a) => {
      const rawTeam = (a as AgentNode & { team?: string }).team || "unassigned";
      const team = normalizeTeam(rawTeam);
      if (team === "__skip__") return acc;
      if (!acc[team]) acc[team] = [];
      acc[team].push(a);
      return acc;
    },
    {} as Record<string, AgentNode[]>,
  );
  const teamList = Object.entries(teams).map(([name, members]) => ({
    name,
    displayName: TEAM_DISPLAY_NAMES[name] || name,
    members,
    active: members.filter((m) => m.status === "active").length,
    color: members[0]?.color || C.nucleus,
  }));

  // Load providers via gateway WebSocket RPC (works in Swift wrapper — no cross-origin issues)
  useEffect(() => {
    if (!gatewayRequest) return;
    if (initialProviders && initialProviders.length > 0) return;
    const load = async () => {
      try {
        const snapshot = (await gatewayRequest("config.get", {})) as Record<string, unknown>;
        // config.get returns ConfigFileSnapshot: { parsed, config, ... }
        // Use "config" (processed with defaults) or fall back to "parsed" (raw JSON)
        const cfg = (snapshot?.config ?? snapshot?.parsed ?? snapshot) as Record<string, unknown>;

        const auth = (cfg?.auth ?? {}) as Record<string, unknown>;
        const profiles = (auth?.profiles ?? {}) as Record<string, Record<string, unknown>>;

        // Determine which providers are ACTIVE via model router
        const agentDefaults = ((cfg?.agents ?? {}) as Record<string, unknown>)?.defaults as
          | Record<string, unknown>
          | undefined;
        const modelRouter = (agentDefaults?.modelRouter ?? {}) as Record<string, unknown>;
        const activeProfileName = modelRouter?.activeProfile as string | undefined;
        const routerProfiles = (modelRouter?.profiles ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        const activeRouterProfile = activeProfileName ? routerProfiles[activeProfileName] : null;

        // Collect provider IDs used in the active router profile tiers + overrides
        const activeProviderIds = new Set<string>();
        if (activeRouterProfile?.tiers) {
          for (const tier of Object.values(
            activeRouterProfile.tiers as Record<string, Record<string, unknown>>,
          )) {
            if (tier?.provider) activeProviderIds.add(String(tier.provider).toLowerCase());
          }
        }
        if (activeRouterProfile?.sessionOverrides) {
          for (const ov of Object.values(
            activeRouterProfile.sessionOverrides as Record<string, Record<string, unknown>>,
          )) {
            if (ov?.provider) activeProviderIds.add(String(ov.provider).toLowerCase());
          }
        }

        // Group auth profiles by provider — use "provider" field from each profile
        const TOOLING_ONLY = new Set(["langchain", "huggingface"]);
        const providerMap = new Map<
          string,
          { id: string; name: string; status: ProviderNode["status"]; profileCount: number }
        >();
        for (const [profileKey, profile] of Object.entries(profiles)) {
          const providerId = (
            typeof profile.provider === "string" ? profile.provider : profileKey.split(":")[0]
          ).toLowerCase();
          if (TOOLING_ONLY.has(providerId)) continue;
          if (!providerMap.has(providerId)) {
            providerMap.set(providerId, {
              id: providerId,
              name:
                PROVIDER_DISPLAY_NAMES[providerId] ||
                providerId.charAt(0).toUpperCase() + providerId.slice(1),
              status: activeProviderIds.has(providerId) ? "active" : "standby",
              profileCount: 0,
            });
          }
          providerMap.get(providerId)!.profileCount++;
        }

        // Also add providers from router tiers not in auth profiles (e.g. ollama)
        for (const pid of activeProviderIds) {
          if (!providerMap.has(pid)) {
            providerMap.set(pid, {
              id: pid,
              name: PROVIDER_DISPLAY_NAMES[pid] || pid.charAt(0).toUpperCase() + pid.slice(1),
              status: "active",
              profileCount: 0,
            });
          }
        }

        const provList = Array.from(providerMap.values());
        if (provList.length > 0) {
          // Sort: active first, then alphabetical
          provList.sort((a, b) => {
            if (a.status === "active" && b.status !== "active") return -1;
            if (b.status === "active" && a.status !== "active") return 1;
            return a.name.localeCompare(b.name);
          });
          setProviders(
            provList.map((p) => ({
              id: p.id,
              name: p.name,
              status: p.status,
              color: PROVIDER_COLORS[p.id] || C.nucleus,
            })),
          );
          console.log(
            "[WorkflowMap] ✓ Providers:",
            provList.length,
            "active:",
            [...activeProviderIds],
            provList.map((p) => `${p.name}(${p.status})`),
          );
        }
      } catch (err) {
        console.error("[WorkflowMap] ✗ Provider RPC failed:", err);
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [gatewayRequest]);

  // Load family agents via gateway WebSocket RPC (family.members has roles + teams)
  useEffect(() => {
    if (!gatewayRequest) return;
    if (initialAgents && initialAgents.length > 0) return;
    const agentColors = [
      "#00FFD1",
      "#76ff03",
      "#c084fc",
      "#ff6b6b",
      "#ffab00",
      "#4285f4",
      "#ec4899",
      "#f97316",
      "#06b6d4",
      "#84cc16",
      "#e879f9",
      "#fbbf24",
      "#22d3ee",
      "#a3e635",
      "#f472b6",
      "#facc15",
      "#2dd4bf",
    ];
    const load = async () => {
      try {
        const data = (await gatewayRequest("family.members", {})) as Record<string, unknown>;
        const membersList = (data?.members ?? []) as Array<Record<string, unknown>>;
        // Filter to operational agents only (no think tank, test, system internals)
        const operational = membersList.filter((m) =>
          isOperationalAgent({
            id: String(m.id || ""),
            role: m.role ? String(m.role) : undefined,
            name: m.name ? String(m.name) : undefined,
          }),
        );
        if (operational.length > 0) {
          setAgents(
            operational.map(
              (a, i) =>
                ({
                  id: String(a.id || ""),
                  name: String(a.name || a.id || ""),
                  role: String(a.role || "Agent"),
                  color: agentColors[i % agentColors.length],
                  status: a.alive ? ("active" as const) : ("idle" as const),
                  currentTask: a.currentTask ? String(a.currentTask) : undefined,
                  team: a.team ? String(a.team) : undefined,
                }) as AgentNode & { team?: string },
            ),
          );
          console.log(
            "[WorkflowMap] ✓ Family agents via RPC:",
            operational.length,
            "(filtered from",
            membersList.length,
            "total)",
          );
        }
      } catch (err) {
        console.warn("[WorkflowMap] Family members RPC error:", err);
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [gatewayRequest]);

  // ── Render ──────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = cssSizeRef.current.w;
    const h = cssSizeRef.current.h;
    const cx = w / 2;
    const cy = h * 0.42;
    const now = timeRef.current;
    const nucleusR = Math.min(w, h) * 0.14; // ~14% of canvas = large nucleus

    // ── Layer 1: Background ──
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
    bg.addColorStop(0, "#0a0e1a");
    bg.addColorStop(0.5, "#060a10");
    bg.addColorStop(1, "#030508");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Stars
    if (starsRef.current.length === 0) starsRef.current = makeStars(150, w, h);
    for (const s of starsRef.current) {
      const a = s.brightness * (Math.sin(now * s.speed + s.offset) * 0.3 + 0.7);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Layer 2: Thick orbital rings ──
    for (let i = 0; i < 3; i++) {
      const r = nucleusR * (1.3 + i * 0.45);
      ctx.strokeStyle = i === 0 ? C.ringDash : C.ring;
      ctx.lineWidth = i === 0 ? 2.5 : 1;
      ctx.setLineDash(i === 0 ? [6, 3] : [3, 8]);
      ctx.lineDashOffset = -now * (0.015 + i * 0.005);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // ── Layer 3+4: Providers (upper arc) ──
    const provR = Math.min(w, h) * 0.35;
    // Full upper arc: from -0.92π to -0.08π
    const provArcStart = -Math.PI * 0.92;
    const provArcSpan = Math.PI * 0.84;
    providers.forEach((prov, i) => {
      const angle =
        providers.length === 1
          ? -Math.PI / 2
          : provArcStart + (i / (providers.length - 1)) * provArcSpan;
      const px = cx + Math.cos(angle) * provR;
      const py = cy + Math.sin(angle) * provR;
      const rgb = hexToRgb(prov.color);
      const isActive = prov.status === "active";

      // Active: big orb (16px). Standby: small orb (9px).
      const orbR = isActive ? 16 : 9;

      // Connection line — only for active providers
      if (isActive) {
        ctx.strokeStyle = C.connectionActive;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.8 + Math.sin(now * 0.003) * 0.2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.stroke();

        // Data flow particles
        const t = (now * 0.001) % 1;
        for (let p = 0; p < 3; p++) {
          const pt = (t + p * 0.33) % 1;
          const fx = cx + (px - cx) * pt;
          const fy = cy + (py - cy) * pt;
          ctx.fillStyle = C.connectionActive;
          ctx.beginPath();
          ctx.arc(fx, fy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else {
        // Standby: thin dim line
        ctx.strokeStyle = C.connectionIdle;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Provider orb (3D sphere)
      const orbG = ctx.createRadialGradient(
        px - orbR * 0.3,
        py - orbR * 0.3,
        orbR * 0.1,
        px,
        py,
        orbR,
      );
      if (isActive) {
        orbG.addColorStop(0, prov.color);
        orbG.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)`);
      } else if (prov.status === "error") {
        orbG.addColorStop(0, "#ff6b6b");
        orbG.addColorStop(1, "#4a0000");
      } else {
        // Standby: subtle tinted sphere instead of big gray blob
        orbG.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.4)`);
        orbG.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.08)`);
      }
      ctx.fillStyle = orbG;
      ctx.beginPath();
      ctx.arc(px, py, orbR, 0, Math.PI * 2);
      ctx.fill();

      // Spinning ring for active only
      if (isActive) {
        ctx.strokeStyle = prov.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 5]);
        ctx.lineDashOffset = now * 0.04;
        ctx.beginPath();
        ctx.arc(px, py, orbR + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // Brackets for active
        drawBrackets(ctx, px, py, orbR + 2);
      }

      // Label
      ctx.fillStyle = isActive ? C.text : C.textDim;
      ctx.font = isActive ? "11px 'JetBrains Mono', monospace" : "9px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(prov.name, px, py + orbR + (isActive ? 18 : 14));
      if (isActive) {
        ctx.font = "9px 'JetBrains Mono', monospace";
        ctx.fillStyle = C.textDim;
        ctx.fillText("Provider", px, py + orbR + 30);
      }
    });

    // ── Layer 5: Team clusters OR expanded agents ──
    const agentR = Math.min(w, h) * 0.38;

    if (expandedTeam && teams[expandedTeam]) {
      // EXPANDED VIEW: show individual agents of the selected team
      const members = teams[expandedTeam];
      const nodeSize = 28;
      members.forEach((agent, i) => {
        const angle =
          members.length === 1
            ? Math.PI / 2
            : Math.PI * 0.1 + (i / (members.length - 1)) * Math.PI * 0.8;
        const ax = cx + Math.cos(angle) * agentR;
        const ay = cy + Math.sin(angle) * agentR;
        const rgb = hexToRgb(agent.color);

        // Connection line
        ctx.strokeStyle = agent.status === "active" ? agent.color : C.connectionIdle;
        ctx.lineWidth = agent.status === "active" ? 2 : 1;
        ctx.globalAlpha = agent.status === "active" ? 0.7 : 0.2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Node glow + background
        const glow = ctx.createRadialGradient(ax, ay, nodeSize * 0.5, ax, ay, nodeSize * 1.4);
        glow.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)`);
        glow.addColorStop(1, "transparent");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(ax, ay, nodeSize * 1.4, 0, Math.PI * 2);
        ctx.fill();

        const nbg = ctx.createRadialGradient(ax, ay, 0, ax, ay, nodeSize);
        nbg.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.2)`);
        nbg.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.05)`);
        ctx.fillStyle = nbg;
        ctx.beginPath();
        ctx.arc(ax, ay, nodeSize, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.5)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ax, ay, nodeSize, 0, Math.PI * 2);
        ctx.stroke();

        // Unique motif
        MOTIFS[i % MOTIFS.length](ctx, ax, ay, nodeSize, agent.color, now);
        drawBrackets(ctx, ax, ay, nodeSize + 2);

        // Status ring
        if (agent.status === "active") {
          ctx.strokeStyle = agent.color;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.lineDashOffset = now * 0.03;
          ctx.beginPath();
          ctx.arc(ax, ay, nodeSize + 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Labels
        ctx.fillStyle = agent.color;
        ctx.font = "bold 10px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(agent.name, ax, ay + nodeSize + 18);
        ctx.font = "9px Inter, system-ui, sans-serif";
        ctx.fillStyle = C.textDim;
        ctx.fillText(
          String((agent as AgentNode & { role?: string }).role || "Agent").replace(/_/g, " "),
          ax,
          ay + nodeSize + 30,
        );
        // Show current task label under active agents
        if (agent.status === "active" && agent.currentTask) {
          ctx.font = "italic 8px Inter, system-ui, sans-serif";
          ctx.fillStyle = agent.color;
          ctx.globalAlpha = 0.7;
          const taskLabel =
            agent.currentTask.length > 28
              ? agent.currentTask.slice(0, 25) + "…"
              : agent.currentTask;
          ctx.fillText(`⚡ ${taskLabel}`, ax, ay + nodeSize + 41);
          ctx.globalAlpha = 1.0;
        }
      });

      // Team name label at top of arc
      ctx.fillStyle = C.hudLabel;
      ctx.font = "bold 12px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      const expandedDisplayName = TEAM_DISPLAY_NAMES[expandedTeam] || expandedTeam;
      ctx.fillText(
        `[ ${expandedDisplayName.toUpperCase()} — ${members.length} agents ]`,
        cx,
        h * 0.92,
      );
      ctx.font = "10px Inter, system-ui, sans-serif";
      ctx.fillStyle = C.textDim;
      ctx.fillText("Click background to collapse", cx, h * 0.95);
    } else {
      // CLUSTER VIEW: show team bubbles
      const clusterSize = 24 + Math.min(8, teamList.length) * 2; // scale with team count
      // Store click targets for team selection
      const clickTargetsLocal: Array<{ x: number; y: number; r: number; team: string }> = [];

      teamList.forEach((team, i) => {
        const angle =
          teamList.length === 1
            ? Math.PI / 2
            : Math.PI * 0.1 + (i / (teamList.length - 1)) * Math.PI * 0.8;
        const tx = cx + Math.cos(angle) * agentR;
        const ty = cy + Math.sin(angle) * agentR;
        const rgb = hexToRgb(team.color);

        clickTargetsLocal.push({ x: tx, y: ty, r: clusterSize + 10, team: team.name });

        // Connection line
        ctx.strokeStyle = team.active > 0 ? team.color : C.connectionIdle;
        ctx.lineWidth = team.active > 0 ? 2 : 1;
        ctx.globalAlpha = team.active > 0 ? 0.5 : 0.15;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Team bubble glow
        const glow = ctx.createRadialGradient(tx, ty, clusterSize * 0.3, tx, ty, clusterSize * 1.5);
        glow.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`);
        glow.addColorStop(1, "transparent");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(tx, ty, clusterSize * 1.5, 0, Math.PI * 2);
        ctx.fill();

        // Bubble
        const bg = ctx.createRadialGradient(tx, ty, 0, tx, ty, clusterSize);
        bg.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.25)`);
        bg.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.08)`);
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(tx, ty, clusterSize, 0, Math.PI * 2);
        ctx.fill();

        // Border
        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.4)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(tx, ty, clusterSize, 0, Math.PI * 2);
        ctx.stroke();

        // Agent count in center
        ctx.fillStyle = team.color;
        ctx.font = "bold 16px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(team.members.length), tx, ty + 5);

        // Brackets
        drawBrackets(ctx, tx, ty, clusterSize + 2);

        // Team name below
        ctx.fillStyle = team.color;
        ctx.font = "bold 10px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(team.displayName, tx, ty + clusterSize + 18);
        ctx.font = "9px Inter, system-ui, sans-serif";
        ctx.fillStyle = C.textDim;
        ctx.fillText(`${team.members.length} agents`, tx, ty + clusterSize + 30);
      });

      // Store click targets for the click handler
      clickTargetsRef.current = clickTargetsLocal;
    }

    // ── Layer 6: Nucleus ──
    // Outer glow
    const ng = ctx.createRadialGradient(cx, cy, nucleusR * 0.3, cx, cy, nucleusR * 2.2);
    ng.addColorStop(0, "rgba(0,170,255,0.12)");
    ng.addColorStop(0.6, "rgba(0,170,255,0.04)");
    ng.addColorStop(1, "transparent");
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.arc(cx, cy, nucleusR * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // 3D sphere
    const sg = ctx.createRadialGradient(
      cx - nucleusR * 0.3,
      cy - nucleusR * 0.3,
      nucleusR * 0.1,
      cx,
      cy,
      nucleusR,
    );
    sg.addColorStop(0, "#60CFFF");
    sg.addColorStop(0.4, "#00AAFF");
    sg.addColorStop(1, "#001833");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(cx, cy, nucleusR, 0, Math.PI * 2);
    ctx.fill();

    // Atom rings inside nucleus
    ctx.strokeStyle = "rgba(96,207,255,0.35)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(now * 0.0008 + (i * Math.PI) / 3);
      ctx.scale(1, 0.35);
      ctx.beginPath();
      ctx.arc(0, 0, nucleusR * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Nucleus label
    ctx.fillStyle = C.text;
    ctx.font = "bold 14px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(agentName, cx, cy + nucleusR + 22);
    ctx.font = "11px 'JetBrains Mono', monospace";
    ctx.fillStyle = connected ? C.connectionActive : C.textDim;
    ctx.fillText(agentStatus, cx, cy + nucleusR + 36);

    // ── Layer 7: HUD overlays ──
    ctx.font = "bold 10px 'JetBrains Mono', monospace";

    // System status
    ctx.fillStyle = connected ? C.connectionActive : C.connectionError;
    ctx.textAlign = "left";
    ctx.fillText(connected ? "[SYSTEM ONLINE]" : "[SYSTEM OFFLINE]", 16, 24);

    // HUD labels around nucleus
    ctx.fillStyle = C.hudLabel;
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText(`[CPU: ${connected ? "ACTIVE" : "IDLE"}]`, cx - nucleusR * 1.6, cy - 10);
    ctx.textAlign = "right";
    ctx.fillText(`[MEM: ${connected ? "OK" : "—"}]`, cx + nucleusR * 1.6, cy - 10);
    ctx.textAlign = "left";
    ctx.fillText(`[SESS: ${agents.length + 1}]`, cx - nucleusR * 1.4, cy + nucleusR * 0.8);

    // Timestamp
    ctx.fillStyle = C.textDim;
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText(new Date().toLocaleTimeString("en-US", { hour12: false }), w - 16, 24);

    // Agent/provider count
    ctx.fillStyle = C.textDim;
    ctx.textAlign = "left";
    ctx.fillText(`AGENTS: ${agents.length} | PROVIDERS: ${providers.length}`, 16, h - 16);

    // Pulse
    const ps = 4 + Math.sin(now * 0.005) * 2;
    ctx.fillStyle = connected ? C.connectionActive : C.connectionError;
    ctx.beginPath();
    ctx.arc(w - 24, h - 20, ps, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.textDim;
    ctx.textAlign = "right";
    ctx.fillText("PULSE", w - 36, h - 16);
  }, [agentName, agentStatus, connected, agents, providers, expandedTeam, teamList]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        cssSizeRef.current = { w: rect.width, h: rect.height };
        starsRef.current = makeStars(150, rect.width, rect.height);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    let running = true;
    const loop = () => {
      if (!running) return;
      timeRef.current = performance.now();
      draw();
      animRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, [draw]);

  // Click handler for team selection
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (expandedTeam) {
        // Click anywhere to collapse back to cluster view
        setExpandedTeam(null);
        return;
      }

      // Check if click hit a team cluster
      for (const target of clickTargetsRef.current) {
        const dx = x - target.x;
        const dy = y - target.y;
        if (Math.sqrt(dx * dx + dy * dy) <= target.r) {
          setExpandedTeam(target.team);
          return;
        }
      }
    },
    [expandedTeam],
  );

  return (
    <div
      className="w-full h-full relative overflow-hidden cursor-pointer"
      style={{ background: C.bg }}
      onClick={handleClick}
    >
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
    </div>
  );
}
