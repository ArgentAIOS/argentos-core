import {
  Search,
  Database,
  Users,
  FolderOpen,
  BookOpen,
  Calendar,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Hash,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

// ── Types ──

interface MemoryStats {
  items: number;
  resources: number;
  categories: number;
  entities: number;
  reflections: number;
  byType: Record<string, number>;
  bySignificance: Record<string, number>;
}

interface MemoryItem {
  id: string;
  resource_id: string | null;
  memory_type: string;
  summary: string;
  happened_at: string | null;
  content_hash: string | null;
  reinforcement_count: number;
  last_reinforced_at: string | null;
  extra: string;
  emotional_valence: number;
  emotional_arousal: number;
  mood_at_capture: string | null;
  significance: string;
  reflection: string | null;
  lesson: string | null;
  created_at: string;
  updated_at: string;
  // From getItem (detail view)
  categories?: Array<{ id: string; name: string; description: string | null }>;
  entities?: Array<{
    id: string;
    name: string;
    entity_type: string;
    bond_strength: number;
    role: string;
  }>;
}

interface Entity {
  id: string;
  name: string;
  entity_type: string;
  relationship: string | null;
  bond_strength: number;
  emotional_texture: string | null;
  profile_summary: string | null;
  first_mentioned_at: string | null;
  last_mentioned_at: string | null;
  memory_count: number;
  created_at: string;
  updated_at: string;
  recentItems?: MemoryItem[];
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  summary: string | null;
  item_count?: number;
  created_at: string;
  updated_at: string;
  items?: MemoryItem[];
}

interface Reflection {
  id: string;
  trigger_type: string;
  period_start: string | null;
  period_end: string | null;
  content: string;
  lessons_extracted: string;
  entities_involved: string;
  self_insights: string;
  mood: string | null;
  created_at: string;
}

interface TimelineEntry {
  date: string;
  count: number;
  byType: Record<string, number>;
}

interface MemoryQualityReport {
  semantics: {
    stats: string;
    entities: string;
    categories: string;
    reflections: string;
    timeline: string;
  };
  sourceMix: Array<{ sourceKind: string; itemCount: number }>;
  fanoutBySource: Array<{
    sourceKind: string;
    resourceCount: number;
    itemCount: number;
    avgItemsPerResource: number;
  }>;
  sis: {
    totalConsolidations: number;
    emptyConsolidations: number;
    duplicateEmptyCandidates: number;
    preview: Array<{ createdDay: string; duplicateCount: number; sample: string }>;
  };
  repairPreview: {
    categoryRenameCandidates: number;
    categoryMergeCandidates: number;
    droppedCategoryCandidates: number;
    exactDuplicateEntityCandidates: number;
    entityMergeCandidates: number;
    duplicateEmptySisCandidates: number;
    categories: Array<{
      agentId: string;
      canonical: string;
      keeperName: string;
      mergeNames: string[];
    }>;
    exactDuplicateEntities: Array<{
      agentId: string;
      canonicalName: string;
      mergeNames: string[];
    }>;
    entities: Array<{ sourceName: string; targetName: string; agentId: string }>;
    manualEntityReview: Array<{
      type: string;
      agentId: string;
      sourceName: string;
      candidates: string[];
    }>;
    reflections: Array<{ createdDay: string; duplicateCount: number; sample: string }>;
  };
  repairHistory: Array<{
    id: string;
    createdAt: string;
    result: {
      categoriesRenamed: number;
      categoriesMerged: number;
      entityMerges: number;
      reflectionsPruned: number;
    };
    beforeStats: {
      items: number;
      resources: number;
      categories: number;
      entities: number;
      reflections: number;
    };
    afterStats: {
      items: number;
      resources: number;
      categories: number;
      entities: number;
      reflections: number;
    };
    preview: {
      categoryRenameCandidates: number;
      categoryMergeCandidates: number;
      droppedCategoryCandidates: number;
      exactDuplicateEntityCandidates: number;
      entityMergeCandidates: number;
      duplicateEmptySisCandidates: number;
      manualEntityReviewCount: number;
    };
  }>;
}

// ── Constants ──

type SubTab = "stats" | "browser" | "entities" | "categories" | "reflections" | "timeline";

const TYPE_COLORS: Record<string, string> = {
  profile: "bg-blue-500/20 text-blue-400",
  event: "bg-green-500/20 text-green-400",
  knowledge: "bg-purple-500/20 text-purple-400",
  behavior: "bg-orange-500/20 text-orange-400",
  skill: "bg-cyan-500/20 text-cyan-400",
  tool: "bg-zinc-500/20 text-zinc-400",
  self: "bg-pink-500/20 text-pink-400",
  episode: "bg-yellow-500/20 text-yellow-400",
};

const SIG_COLORS: Record<string, string> = {
  routine: "bg-zinc-500/20 text-zinc-400",
  noteworthy: "bg-yellow-500/20 text-yellow-400",
  important: "bg-orange-500/20 text-orange-400",
  core: "bg-red-500/20 text-red-400",
};

const TYPE_BAR_COLORS: Record<string, string> = {
  profile: "bg-blue-500",
  event: "bg-green-500",
  knowledge: "bg-purple-500",
  behavior: "bg-orange-500",
  skill: "bg-cyan-500",
  tool: "bg-zinc-500",
  self: "bg-pink-500",
  episode: "bg-yellow-500",
};

const MEMORY_TYPE_ORDER = [
  "profile",
  "event",
  "knowledge",
  "behavior",
  "skill",
  "tool",
  "self",
  "episode",
];

const SIG_BAR_COLORS: Record<string, string> = {
  routine: "bg-zinc-500",
  noteworthy: "bg-yellow-500",
  important: "bg-orange-500",
  core: "bg-red-500",
};

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: "bg-blue-500/20 text-blue-400",
  pet: "bg-pink-500/20 text-pink-400",
  place: "bg-green-500/20 text-green-400",
  organization: "bg-purple-500/20 text-purple-400",
  project: "bg-cyan-500/20 text-cyan-400",
  concept: "bg-yellow-500/20 text-yellow-400",
};

// ── Helpers ──

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function emotionDot(valence: number, _arousal: number): string {
  if (valence > 0.2) return "bg-green-400";
  if (valence < -0.2) return "bg-red-400";
  return "bg-zinc-400";
}

function emotionSize(arousal: number): string {
  if (arousal > 0.7) return "w-3 h-3";
  if (arousal > 0.3) return "w-2.5 h-2.5";
  return "w-2 h-2";
}

function Badge({ text, colorClass }: { text: string; colorClass?: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${colorClass || "bg-zinc-700 text-zinc-300"}`}
    >
      {text}
    </span>
  );
}

function parseJson(str: string | null | undefined): unknown[] {
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── API fetch helper ──

async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function postApi<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "POST" });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function downloadApi(path: string, filenameFallback: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename=\"?([^"]+)\"?/i);
  const filename = match?.[1] || filenameFallback;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ── Component ──

export function MemoryConsole() {
  const [subTab, setSubTab] = useState<SubTab>("stats");
  const [error, setError] = useState<string | null>(null);

  const subTabs: Array<{ id: SubTab; label: string; icon: typeof Database }> = [
    { id: "stats", label: "Stats", icon: Database },
    { id: "browser", label: "Browser", icon: Search },
    { id: "entities", label: "Entities", icon: Users },
    { id: "categories", label: "Categories", icon: FolderOpen },
    { id: "reflections", label: "Reflections", icon: BookOpen },
    { id: "timeline", label: "Timeline", icon: Calendar },
  ];

  return (
    <div className="space-y-3">
      {/* Sub-tab navigation */}
      <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-1">
        {subTabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => {
                setSubTab(t.id);
                setError(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                subTab === t.id
                  ? "bg-purple-500/20 text-purple-400"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Sub-tab content */}
      {subTab === "stats" && <StatsView onError={setError} />}
      {subTab === "browser" && <BrowserView onError={setError} />}
      {subTab === "entities" && <EntitiesView onError={setError} />}
      {subTab === "categories" && <CategoriesView onError={setError} />}
      {subTab === "reflections" && <ReflectionsView onError={setError} />}
      {subTab === "timeline" && <TimelineView onError={setError} />}
    </div>
  );
}

// ── Stats View ──

function StatsView({ onError }: { onError: (e: string | null) => void }) {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [quality, setQuality] = useState<MemoryQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [statsData, qualityData] = await Promise.all([
        fetchApi<MemoryStats>("/api/memory/stats"),
        fetchApi<MemoryQualityReport>("/api/memory/quality"),
      ]);
      setStats(statsData);
      setQuality(qualityData);
      onError(null);
    } catch (err: any) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const applyRepair = useCallback(async () => {
    if (!quality) return;
    const previewTotal =
      quality.repairPreview.categoryMergeCandidates +
      quality.repairPreview.categoryRenameCandidates +
      quality.repairPreview.entityMergeCandidates +
      quality.repairPreview.duplicateEmptySisCandidates;
    const confirmed = window.confirm(
      `Apply memory repair?\n\n` +
        `Category renames: ${quality.repairPreview.categoryRenameCandidates}\n` +
        `Category merges: ${quality.repairPreview.categoryMergeCandidates}\n` +
        `Entity merges: ${quality.repairPreview.entityMergeCandidates}\n` +
        `Reflection prunes: ${quality.repairPreview.duplicateEmptySisCandidates}\n\n` +
        `This rewrites historical memory records in PostgreSQL.`,
    );
    if (!confirmed || previewTotal === 0) return;
    try {
      setRepairing(true);
      await postApi("/api/memory/repair/apply");
      await load();
      onError(null);
    } catch (err: any) {
      onError(err.message);
    } finally {
      setRepairing(false);
    }
  }, [load, onError, quality]);

  const exportRepair = useCallback(async () => {
    try {
      await downloadApi("/api/memory/repair/export", "memory-repair-export.json");
      onError(null);
    } catch (err: any) {
      onError(err.message);
    }
  }, [onError]);

  if (loading || !stats || !quality) {
    return <div className="text-zinc-500 text-sm py-4 text-center">Loading stats...</div>;
  }

  const maxType = Math.max(...Object.values(stats.byType), 1);
  const maxSig = Math.max(...Object.values(stats.bySignificance), 1);

  return (
    <div className="space-y-4">
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-[11px] text-blue-200">
        <div className="font-semibold uppercase tracking-wide text-[10px] text-blue-300 mb-1">
          Inspector Semantics
        </div>
        <div>{quality.semantics.stats}</div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Memory Items", value: stats.items, color: "text-purple-400" },
          { label: "Entities", value: stats.entities, color: "text-blue-400" },
          { label: "Categories", value: stats.categories, color: "text-green-400" },
          { label: "Reflections", value: stats.reflections, color: "text-yellow-400" },
          { label: "Resources", value: stats.resources, color: "text-cyan-400" },
        ].map((s) => (
          <div key={s.label} className="bg-zinc-800/50 rounded-lg p-3">
            <div className={`text-xl font-bold font-mono ${s.color}`}>
              {s.value.toLocaleString()}
            </div>
            <div className="text-zinc-500 text-xs">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-zinc-800/50 rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-zinc-300 text-xs font-semibold uppercase tracking-wide">
              Repair Preview
            </h3>
            <p className="text-zinc-500 text-[11px] mt-1">
              Historical cleanup candidates based on the new normalization rules.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportRepair}
              className="px-3 py-1.5 rounded-md bg-zinc-700/60 text-zinc-200 text-xs font-medium hover:bg-zinc-700"
            >
              Export metrics
            </button>
            <button
              onClick={applyRepair}
              disabled={repairing}
              className="px-3 py-1.5 rounded-md bg-purple-500/20 text-purple-300 text-xs font-medium hover:bg-purple-500/30 disabled:opacity-50"
            >
              {repairing ? "Applying..." : "Apply repair"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Category renames", quality.repairPreview.categoryRenameCandidates],
            ["Category merges", quality.repairPreview.categoryMergeCandidates],
            ["Dropped category candidates", quality.repairPreview.droppedCategoryCandidates],
            ["Exact duplicate entity merges", quality.repairPreview.exactDuplicateEntityCandidates],
            ["Safe alias entity merges", quality.repairPreview.entityMergeCandidates],
            ["Duplicate SIS reflections", quality.repairPreview.duplicateEmptySisCandidates],
          ].map(([label, value]) => (
            <div key={label} className="bg-zinc-900/60 rounded-md p-2">
              <div className="text-zinc-500 text-[10px] uppercase tracking-wide">{label}</div>
              <div className="text-zinc-100 font-mono text-lg">{value}</div>
            </div>
          ))}
        </div>
        {quality.repairHistory.length > 0 && (
          <div className="space-y-1">
            <div className="text-zinc-500 text-[10px] uppercase tracking-wide">Last repair run</div>
            <div className="bg-zinc-900/60 rounded-md p-2 text-[11px] text-zinc-300 space-y-1">
              <div>{formatDateTime(quality.repairHistory[0]?.createdAt)}</div>
              <div>
                Categories {quality.repairHistory[0]?.result.categoriesRenamed} renamed,{" "}
                {quality.repairHistory[0]?.result.categoriesMerged} merged
              </div>
              <div>
                Entities {quality.repairHistory[0]?.result.entityMerges} merged, reflections{" "}
                {quality.repairHistory[0]?.result.reflectionsPruned} pruned
              </div>
              <div className="text-zinc-500">
                Before: {quality.repairHistory[0]?.beforeStats.categories} categories /{" "}
                {quality.repairHistory[0]?.beforeStats.entities} entities /{" "}
                {quality.repairHistory[0]?.beforeStats.reflections} reflections
              </div>
              <div className="text-zinc-500">
                After: {quality.repairHistory[0]?.afterStats.categories} categories /{" "}
                {quality.repairHistory[0]?.afterStats.entities} entities /{" "}
                {quality.repairHistory[0]?.afterStats.reflections} reflections
              </div>
            </div>
          </div>
        )}
        {quality.repairPreview.exactDuplicateEntities.length > 0 && (
          <div className="space-y-1">
            <div className="text-zinc-500 text-[10px] uppercase tracking-wide">
              Exact duplicate entity repairs
            </div>
            {quality.repairPreview.exactDuplicateEntities.slice(0, 4).map((entry) => (
              <div
                key={`${entry.agentId}:${entry.canonicalName}`}
                className="text-[11px] text-zinc-300"
              >
                {entry.mergeNames.join(", ")} → {entry.canonicalName}
              </div>
            ))}
          </div>
        )}
        {quality.repairPreview.entities.length > 0 && (
          <div className="space-y-1">
            <div className="text-zinc-500 text-[10px] uppercase tracking-wide">
              Safe alias merge examples
            </div>
            {quality.repairPreview.entities.slice(0, 4).map((entry) => (
              <div
                key={`${entry.agentId}:${entry.sourceName}:${entry.targetName}`}
                className="text-[11px] text-zinc-300"
              >
                {entry.sourceName} → {entry.targetName}
              </div>
            ))}
          </div>
        )}
        {quality.repairPreview.manualEntityReview.length > 0 && (
          <div className="space-y-1">
            <div className="text-zinc-500 text-[10px] uppercase tracking-wide">
              Manual entity review
            </div>
            {quality.repairPreview.manualEntityReview.slice(0, 6).map((entry) => (
              <div
                key={`${entry.agentId}:${entry.type}:${entry.sourceName}`}
                className="text-[11px] text-zinc-300"
              >
                {entry.sourceName}
                {entry.candidates.length > 0 ? ` ↔ ${entry.candidates.join(", ")}` : ""}
                <span className="text-zinc-500"> ({entry.type.replace(/_/g, " ")})</span>
              </div>
            ))}
          </div>
        )}
        {quality.repairPreview.categories.length > 0 && (
          <div className="space-y-1">
            <div className="text-zinc-500 text-[10px] uppercase tracking-wide">
              Category normalization examples
            </div>
            {quality.repairPreview.categories.slice(0, 4).map((entry) => (
              <div
                key={`${entry.agentId}:${entry.keeperName}:${entry.canonical}`}
                className="text-[11px] text-zinc-300"
              >
                {entry.keeperName}
                {entry.mergeNames.length > 0 ? ` + ${entry.mergeNames.join(", ")}` : ""} →{" "}
                {entry.canonical}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
          <h3 className="text-zinc-300 text-xs font-semibold uppercase tracking-wide">
            Source Mix (30d)
          </h3>
          {quality.sourceMix.map((entry) => (
            <div key={entry.sourceKind} className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">{entry.sourceKind}</span>
              <span className="text-zinc-200 font-mono">{entry.itemCount}</span>
            </div>
          ))}
        </div>
        <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
          <h3 className="text-zinc-300 text-xs font-semibold uppercase tracking-wide">
            Extraction Fan-Out (30d)
          </h3>
          {quality.fanoutBySource.map((entry) => (
            <div key={entry.sourceKind} className="flex items-center justify-between text-xs gap-2">
              <span className="text-zinc-400">{entry.sourceKind}</span>
              <span className="text-zinc-500">
                {entry.itemCount}/{entry.resourceCount}
              </span>
              <span className="text-zinc-200 font-mono">
                {entry.avgItemsPerResource.toFixed(2)}x
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
        <h3 className="text-zinc-300 text-xs font-semibold uppercase tracking-wide">SIS Dedupe</h3>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Total SIS consolidations", quality.sis.totalConsolidations],
            ["Empty consolidations", quality.sis.emptyConsolidations],
            ["Duplicate empty candidates", quality.sis.duplicateEmptyCandidates],
          ].map(([label, value]) => (
            <div key={label} className="bg-zinc-900/60 rounded-md p-2">
              <div className="text-zinc-500 text-[10px] uppercase tracking-wide">{label}</div>
              <div className="text-zinc-100 font-mono text-lg">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* By Type */}
      <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
        <h3 className="text-zinc-300 text-xs font-semibold uppercase tracking-wide">
          Items by Type
        </h3>
        {Object.entries(stats.byType)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => (
            <div key={type} className="flex items-center gap-2">
              <span className="text-zinc-400 text-xs w-20 truncate">{type}</span>
              <div className="flex-1 h-4 bg-zinc-900 rounded overflow-hidden">
                <div
                  className={`h-full rounded ${TYPE_BAR_COLORS[type] || "bg-zinc-600"}`}
                  style={{ width: `${(count / maxType) * 100}%` }}
                />
              </div>
              <span className="text-zinc-400 text-xs font-mono w-10 text-right">{count}</span>
            </div>
          ))}
      </div>

      {/* By Significance */}
      <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
        <h3 className="text-zinc-300 text-xs font-semibold uppercase tracking-wide">
          Items by Significance
        </h3>
        {["core", "important", "noteworthy", "routine"]
          .filter((s) => stats.bySignificance[s])
          .map((sig) => {
            const count = stats.bySignificance[sig] || 0;
            return (
              <div key={sig} className="flex items-center gap-2">
                <span className="text-zinc-400 text-xs w-20 truncate">{sig}</span>
                <div className="flex-1 h-4 bg-zinc-900 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${SIG_BAR_COLORS[sig] || "bg-zinc-600"}`}
                    style={{ width: `${(count / maxSig) * 100}%` }}
                  />
                </div>
                <span className="text-zinc-400 text-xs font-mono w-10 text-right">{count}</span>
              </div>
            );
          })}
      </div>

      <button
        onClick={load}
        className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
      >
        <RefreshCw className="w-3 h-3" /> Refresh
      </button>
    </div>
  );
}

// ── Browser View ──

function BrowserView({ onError }: { onError: (e: string | null) => void }) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sigFilter, setSigFilter] = useState("");
  const [sort, setSort] = useState("created_at_desc");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<MemoryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const pageSize = 25;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (typeFilter) params.set("type", typeFilter);
      if (sigFilter) params.set("significance", sigFilter);
      params.set("sort", sort);
      params.set("limit", String(pageSize));
      params.set("offset", String(page * pageSize));

      const data = await fetchApi<{ items: MemoryItem[]; total: number }>(
        `/api/memory/items?${params}`,
      );
      setItems(data.items);
      setTotal(data.total);
      onError(null);
    } catch (err: any) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, typeFilter, sigFilter, sort, page, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const expandItem = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedItem(null);
      return;
    }
    try {
      const data = await fetchApi<MemoryItem>(`/api/memory/items/${id}`);
      setExpandedId(id);
      setExpandedItem(data);
    } catch (err: any) {
      onError(err.message);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-3">
      {/* Search + Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px] relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search memories..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(0);
          }}
          className="bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 px-2 py-1.5 focus:outline-none"
        >
          <option value="">All types</option>
          {Object.keys(TYPE_COLORS).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={sigFilter}
          onChange={(e) => {
            setSigFilter(e.target.value);
            setPage(0);
          }}
          className="bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 px-2 py-1.5 focus:outline-none"
        >
          <option value="">All significance</option>
          {Object.keys(SIG_COLORS).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 px-2 py-1.5 focus:outline-none"
        >
          <option value="created_at_desc">Newest</option>
          <option value="created_at_asc">Oldest</option>
          <option value="reinforcement_desc">Most reinforced</option>
          <option value="significance_desc">Highest significance</option>
        </select>
      </div>

      {/* Results count */}
      <div className="text-zinc-500 text-xs">
        {total.toLocaleString()} items
        {totalPages > 1 && ` — page ${page + 1} of ${totalPages}`}
      </div>

      {/* Items list */}
      {loading ? (
        <div className="text-zinc-500 text-sm py-4 text-center">Loading...</div>
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <div key={item.id}>
              <button
                onClick={() => expandItem(item.id)}
                className="w-full text-left bg-zinc-800/30 hover:bg-zinc-800/60 rounded-lg px-3 py-2 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {expandedId === item.id ? (
                    <ChevronDown className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                  )}
                  <Badge text={item.memory_type} colorClass={TYPE_COLORS[item.memory_type]} />
                  <span className="text-zinc-200 text-xs truncate flex-1">
                    {item.summary?.slice(0, 120)}
                    {(item.summary?.length || 0) > 120 && "..."}
                  </span>
                  <Badge text={item.significance} colorClass={SIG_COLORS[item.significance]} />
                  <div
                    className={`rounded-full flex-shrink-0 ${emotionDot(item.emotional_valence, item.emotional_arousal)} ${emotionSize(item.emotional_arousal)}`}
                    title={`valence: ${item.emotional_valence}, arousal: ${item.emotional_arousal}`}
                  />
                  {item.reinforcement_count > 1 && (
                    <span className="text-zinc-500 text-[10px] font-mono">
                      x{item.reinforcement_count}
                    </span>
                  )}
                  <span className="text-zinc-600 text-[10px] font-mono flex-shrink-0">
                    {formatDate(item.created_at)}
                  </span>
                </div>
              </button>

              {/* Expanded detail */}
              {expandedId === item.id && expandedItem && (
                <div className="ml-5 mt-1 mb-2 bg-zinc-900/60 border border-zinc-700/50 rounded-lg p-3 space-y-2">
                  <div className="text-zinc-200 text-xs whitespace-pre-wrap">
                    {expandedItem.summary}
                  </div>

                  {expandedItem.reflection && (
                    <div>
                      <span className="text-zinc-500 text-[10px] uppercase tracking-wide">
                        Reflection
                      </span>
                      <div className="text-zinc-300 text-xs mt-0.5">{expandedItem.reflection}</div>
                    </div>
                  )}

                  {expandedItem.lesson && (
                    <div>
                      <span className="text-zinc-500 text-[10px] uppercase tracking-wide">
                        Lesson
                      </span>
                      <div className="text-zinc-300 text-xs mt-0.5">{expandedItem.lesson}</div>
                    </div>
                  )}

                  {/* Categories */}
                  {expandedItem.categories && expandedItem.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      <span className="text-zinc-500 text-[10px] uppercase tracking-wide mr-1">
                        Categories:
                      </span>
                      {expandedItem.categories.map((c) => (
                        <Badge
                          key={c.id}
                          text={c.name}
                          colorClass="bg-green-500/15 text-green-400"
                        />
                      ))}
                    </div>
                  )}

                  {/* Entities */}
                  {expandedItem.entities && expandedItem.entities.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      <span className="text-zinc-500 text-[10px] uppercase tracking-wide mr-1">
                        Entities:
                      </span>
                      {expandedItem.entities.map((e) => (
                        <Badge
                          key={e.id}
                          text={`${e.name} (${e.bond_strength.toFixed(1)})`}
                          colorClass={
                            ENTITY_TYPE_COLORS[e.entity_type] || "bg-zinc-700 text-zinc-300"
                          }
                        />
                      ))}
                    </div>
                  )}

                  {/* Metadata row */}
                  <div className="flex flex-wrap gap-3 text-[10px] font-mono text-zinc-500 pt-1 border-t border-zinc-700/50">
                    <span>
                      Emotion: v={expandedItem.emotional_valence} a=
                      {expandedItem.emotional_arousal}
                    </span>
                    {expandedItem.mood_at_capture && (
                      <span>Mood: {expandedItem.mood_at_capture}</span>
                    )}
                    <span>Reinforced: {expandedItem.reinforcement_count}x</span>
                    <span>Created: {formatDateTime(expandedItem.created_at)}</span>
                    {expandedItem.happened_at && (
                      <span>Happened: {formatDateTime(expandedItem.happened_at)}</span>
                    )}
                    <span title={expandedItem.id}>
                      <Hash className="w-2.5 h-2.5 inline" />
                      {expandedItem.id.slice(0, 8)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}

          {items.length === 0 && !loading && (
            <div className="text-zinc-500 text-sm py-4 text-center">No items found</div>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <span className="text-zinc-500 text-xs">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ── Entities View ──

function EntitiesView({ onError }: { onError: (e: string | null) => void }) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedEntity, setExpandedEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchApi<{ entities: Entity[]; total: number }>(
        "/api/memory/entities?limit=100",
      );
      setEntities(data.entities);
      setTotal(data.total);
      onError(null);
    } catch (err: any) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const expand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedEntity(null);
      return;
    }
    try {
      const data = await fetchApi<Entity>(`/api/memory/entities/${id}`);
      setExpandedId(id);
      setExpandedEntity(data);
    } catch (err: any) {
      onError(err.message);
    }
  };

  if (loading) {
    return <div className="text-zinc-500 text-sm py-4 text-center">Loading entities...</div>;
  }

  return (
    <div className="space-y-2">
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-[11px] text-blue-200">
        Showing raw entity rows from PostgreSQL. Historical aliases remain separate here until
        repaired.
      </div>
      <div className="text-zinc-500 text-xs">{total} entities</div>

      {entities.map((entity) => (
        <div key={entity.id}>
          <button
            onClick={() => expand(entity.id)}
            className="w-full text-left bg-zinc-800/30 hover:bg-zinc-800/60 rounded-lg px-3 py-2.5 transition-colors"
          >
            <div className="flex items-center gap-2">
              {expandedId === entity.id ? (
                <ChevronDown className="w-3 h-3 text-zinc-500 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />
              )}
              <span className="text-zinc-100 text-sm font-medium">{entity.name}</span>
              <Badge
                text={entity.entity_type}
                colorClass={ENTITY_TYPE_COLORS[entity.entity_type] || "bg-zinc-700 text-zinc-300"}
              />
              {entity.relationship && (
                <span className="text-zinc-500 text-xs truncate">{entity.relationship}</span>
              )}
              <div className="flex-1" />
              {/* Bond strength bar */}
              <div
                className="w-16 h-2 bg-zinc-900 rounded overflow-hidden"
                title={`Bond: ${entity.bond_strength.toFixed(2)}`}
              >
                <div
                  className="h-full rounded bg-purple-500"
                  style={{ width: `${entity.bond_strength * 100}%` }}
                />
              </div>
              <span className="text-zinc-500 text-[10px] font-mono w-8 text-right">
                {entity.memory_count}
              </span>
              <span className="text-zinc-600 text-[10px] font-mono flex-shrink-0">
                {formatDate(entity.last_mentioned_at)}
              </span>
            </div>
          </button>

          {expandedId === entity.id && expandedEntity && (
            <div className="ml-5 mt-1 mb-2 bg-zinc-900/60 border border-zinc-700/50 rounded-lg p-3 space-y-2">
              {expandedEntity.profile_summary && (
                <div className="text-zinc-300 text-xs">{expandedEntity.profile_summary}</div>
              )}
              {expandedEntity.emotional_texture && (
                <div className="text-zinc-400 text-xs italic">
                  {expandedEntity.emotional_texture}
                </div>
              )}
              <div className="flex gap-3 text-[10px] font-mono text-zinc-500">
                <span>Bond: {expandedEntity.bond_strength.toFixed(2)}</span>
                <span>Memories: {expandedEntity.memory_count}</span>
                <span>First: {formatDate(expandedEntity.first_mentioned_at)}</span>
                <span>Last: {formatDate(expandedEntity.last_mentioned_at)}</span>
              </div>

              {expandedEntity.recentItems && expandedEntity.recentItems.length > 0 && (
                <div className="pt-2 border-t border-zinc-700/50 space-y-1">
                  <span className="text-zinc-500 text-[10px] uppercase tracking-wide">
                    Recent memories
                  </span>
                  {expandedEntity.recentItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-xs text-zinc-400">
                      <Badge text={item.memory_type} colorClass={TYPE_COLORS[item.memory_type]} />
                      <span className="truncate">{item.summary?.slice(0, 100)}</span>
                      <span className="text-zinc-600 text-[10px] font-mono flex-shrink-0">
                        {formatDate(item.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {entities.length === 0 && (
        <div className="text-zinc-500 text-sm py-4 text-center">No entities found</div>
      )}
    </div>
  );
}

// ── Categories View ──

function CategoriesView({ onError }: { onError: (e: string | null) => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchApi<{ categories: Category[]; total: number }>(
        "/api/memory/categories?limit=100",
      );
      setCategories(data.categories);
      setTotal(data.total);
      onError(null);
    } catch (err: any) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const expand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedCategory(null);
      return;
    }
    try {
      const data = await fetchApi<Category>(`/api/memory/categories/${id}`);
      setExpandedId(id);
      setExpandedCategory(data);
    } catch (err: any) {
      onError(err.message);
    }
  };

  if (loading) {
    return <div className="text-zinc-500 text-sm py-4 text-center">Loading categories...</div>;
  }

  return (
    <div className="space-y-2">
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-[11px] text-blue-200">
        Showing raw stored categories and linked item counts. Similar names may represent duplicate
        categories until repair is applied.
      </div>
      <div className="text-zinc-500 text-xs">{total} categories</div>

      {categories.map((cat) => (
        <div key={cat.id}>
          <button
            onClick={() => expand(cat.id)}
            className="w-full text-left bg-zinc-800/30 hover:bg-zinc-800/60 rounded-lg px-3 py-2.5 transition-colors"
          >
            <div className="flex items-center gap-2">
              {expandedId === cat.id ? (
                <ChevronDown className="w-3 h-3 text-zinc-500 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />
              )}
              <span className="text-zinc-100 text-sm font-medium">{cat.name}</span>
              {cat.description && (
                <span className="text-zinc-500 text-xs truncate flex-1">
                  {cat.description.slice(0, 60)}
                </span>
              )}
              <span className="bg-zinc-700 text-zinc-300 text-[10px] font-mono px-1.5 py-0.5 rounded">
                {cat.item_count ?? 0}
              </span>
            </div>
          </button>

          {expandedId === cat.id && expandedCategory && (
            <div className="ml-5 mt-1 mb-2 bg-zinc-900/60 border border-zinc-700/50 rounded-lg p-3 space-y-2">
              {expandedCategory.description && (
                <div className="text-zinc-300 text-xs">{expandedCategory.description}</div>
              )}
              {expandedCategory.summary && (
                <div className="text-zinc-400 text-xs italic">{expandedCategory.summary}</div>
              )}

              {expandedCategory.items && expandedCategory.items.length > 0 && (
                <div className="pt-2 border-t border-zinc-700/50 space-y-1">
                  <span className="text-zinc-500 text-[10px] uppercase tracking-wide">
                    Items ({expandedCategory.items.length})
                  </span>
                  {expandedCategory.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-xs text-zinc-400">
                      <Badge text={item.memory_type} colorClass={TYPE_COLORS[item.memory_type]} />
                      <span className="truncate">{item.summary?.slice(0, 100)}</span>
                      <span className="text-zinc-600 text-[10px] font-mono flex-shrink-0">
                        {formatDate(item.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {categories.length === 0 && (
        <div className="text-zinc-500 text-sm py-4 text-center">No categories found</div>
      )}
    </div>
  );
}

// ── Reflections View ──

function ReflectionsView({ onError }: { onError: (e: string | null) => void }) {
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchApi<{ reflections: Reflection[]; total: number }>(
        "/api/memory/reflections?limit=50",
      );
      setReflections(data.reflections);
      setTotal(data.total);
      onError(null);
    } catch (err: any) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div className="text-zinc-500 text-sm py-4 text-center">Loading reflections...</div>;
  }

  const triggerColors: Record<string, string> = {
    heartbeat: "bg-blue-500/20 text-blue-400",
    evening_cron: "bg-purple-500/20 text-purple-400",
    manual: "bg-green-500/20 text-green-400",
  };

  return (
    <div className="space-y-2">
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-[11px] text-blue-200">
        Showing raw reflection rows. Older low-novelty SIS consolidations remain visible here until
        pruned from history.
      </div>
      <div className="text-zinc-500 text-xs">{total} reflections</div>

      {reflections.map((r) => {
        const isExpanded = expandedId === r.id;
        const lessons = parseJson(r.lessons_extracted) as string[];
        const entities = parseJson(r.entities_involved) as string[];
        const insights = parseJson(r.self_insights) as string[];

        return (
          <div key={r.id}>
            <button
              onClick={() => setExpandedId(isExpanded ? null : r.id)}
              className="w-full text-left bg-zinc-800/30 hover:bg-zinc-800/60 rounded-lg px-3 py-2.5 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                )}
                <Badge
                  text={r.trigger_type}
                  colorClass={triggerColors[r.trigger_type] || "bg-zinc-700 text-zinc-300"}
                />
                <span className="text-zinc-300 text-xs truncate flex-1">
                  {r.content?.slice(0, 100)}
                  {(r.content?.length || 0) > 100 && "..."}
                </span>
                {r.mood && <span className="text-zinc-500 text-[10px]">{r.mood}</span>}
                <span className="text-zinc-600 text-[10px] font-mono flex-shrink-0">
                  {formatDate(r.created_at)}
                </span>
              </div>
            </button>

            {isExpanded && (
              <div className="ml-5 mt-1 mb-2 bg-zinc-900/60 border border-zinc-700/50 rounded-lg p-3 space-y-2">
                <div className="text-zinc-200 text-xs whitespace-pre-wrap">{r.content}</div>

                {lessons.length > 0 && (
                  <div>
                    <span className="text-zinc-500 text-[10px] uppercase tracking-wide">
                      Lessons
                    </span>
                    <ul className="list-disc list-inside text-zinc-300 text-xs mt-0.5 space-y-0.5">
                      {lessons.map((l, i) => (
                        <li key={i}>{String(l)}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {insights.length > 0 && (
                  <div>
                    <span className="text-zinc-500 text-[10px] uppercase tracking-wide">
                      Self-Insights
                    </span>
                    <ul className="list-disc list-inside text-zinc-300 text-xs mt-0.5 space-y-0.5">
                      {insights.map((s, i) => (
                        <li key={i}>{String(s)}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {entities.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-zinc-500 text-[10px] uppercase tracking-wide mr-1">
                      Entities:
                    </span>
                    {entities.map((e, i) => (
                      <Badge key={i} text={String(e)} colorClass="bg-blue-500/15 text-blue-400" />
                    ))}
                  </div>
                )}

                <div className="flex gap-3 text-[10px] font-mono text-zinc-500 pt-1 border-t border-zinc-700/50">
                  {r.period_start && <span>Period: {formatDate(r.period_start)}</span>}
                  {r.period_end && <span>to {formatDate(r.period_end)}</span>}
                  {r.mood && <span>Mood: {r.mood}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {reflections.length === 0 && (
        <div className="text-zinc-500 text-sm py-4 text-center">No reflections found</div>
      )}
    </div>
  );
}

// ── Timeline View ──

function sortedTimelineTypes(byType: Record<string, number>) {
  const ordered: Array<[string, number]> = [];
  for (const entry of Object.entries(byType)) {
    if (entry[1] <= 0) {
      continue;
    }
    const insertAt = ordered.findIndex((candidate) => compareTimelineTypes(entry, candidate) < 0);
    if (insertAt === -1) {
      ordered.push(entry);
    } else {
      ordered.splice(insertAt, 0, entry);
    }
  }
  return ordered;
}

function compareTimelineTypes(
  [aType, aCount]: [string, number],
  [bType, bCount]: [string, number],
) {
  const aIndex = MEMORY_TYPE_ORDER.indexOf(aType);
  const bIndex = MEMORY_TYPE_ORDER.indexOf(bType);
  if (aIndex !== -1 || bIndex !== -1) {
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  }
  return bCount - aCount;
}

function dominantTimelineType(byType: Record<string, number>) {
  return Object.entries(byType).reduce<[string, number] | null>((best, entry) => {
    if (entry[1] <= 0) {
      return best;
    }
    if (!best || entry[1] > best[1]) {
      return entry;
    }
    return best;
  }, null);
}

function timelineScalePct(count: number, maxCount: number, scale: "compressed" | "linear") {
  if (count <= 0 || maxCount <= 0) {
    return 0;
  }
  const normalized = count / maxCount;
  const scaled = scale === "compressed" ? Math.sqrt(normalized) : normalized;
  return Math.max(4, Math.min(100, scaled * 100));
}

function TimelineView({ onError }: { onError: (e: string | null) => void }) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState<"compressed" | "linear">("compressed");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchApi<TimelineEntry[]>("/api/memory/timeline?days=30");
      setTimeline(data);
      onError(null);
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div className="text-zinc-500 text-sm py-4 text-center">Loading timeline...</div>;
  }

  if (timeline.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-4 text-center">No data in the last 30 days</div>
    );
  }

  const maxCount = Math.max(...timeline.map((t) => t.count), 1);
  const totalMemories = timeline.reduce((sum, t) => sum + t.count, 0);
  const typeTotals = timeline.reduce<Record<string, number>>((acc, entry) => {
    for (const [type, count] of Object.entries(entry.byType)) {
      acc[type] = (acc[type] ?? 0) + count;
    }
    return acc;
  }, {});
  const sortedTypeTotals = sortedTimelineTypes(typeTotals).reduce<Array<[string, number]>>(
    (ordered, entry) => {
      const insertAt = ordered.findIndex((candidate) => entry[1] > candidate[1]);
      if (insertAt === -1) {
        ordered.push(entry);
      } else {
        ordered.splice(insertAt, 0, entry);
      }
      return ordered;
    },
    [],
  );
  const topDay = timeline.reduce<TimelineEntry | null>((best, entry) => {
    if (!best || entry.count > best.count) {
      return entry;
    }
    return best;
  }, null);
  const newestFirstTimeline = timeline.reduce<TimelineEntry[]>((items, entry) => {
    items.unshift(entry);
    return items;
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-[11px] text-blue-200">
        Timeline counts raw <code className="font-mono">memory_items</code> by created day and
        memory type only. Categories, entities, reflections, and resources are not included in these
        bars.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-zinc-400 text-xs">
          <span className="text-zinc-200 font-medium">Last 30 days</span>
          <span className="text-zinc-500"> — </span>
          <span className="font-mono">{totalMemories.toLocaleString()}</span> memories
          {topDay && (
            <span className="text-zinc-500">
              {" "}
              · peak <span className="font-mono text-zinc-300">{topDay.count}</span> on{" "}
              <span className="font-mono text-zinc-300">{topDay.date}</span>
            </span>
          )}
        </div>
        <div className="flex items-center rounded-md border border-zinc-700 bg-zinc-900/70 p-0.5">
          {(["compressed", "linear"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setScale(mode)}
              className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
                scale === mode
                  ? "rounded bg-blue-500/20 text-blue-200"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {mode === "compressed" ? "Readable" : "Exact"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {sortedTypeTotals.slice(0, 4).map(([type, count]) => (
          <div key={type} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-sm ${TYPE_BAR_COLORS[type] || "bg-zinc-600"}`}
                />
                <span className="truncate text-[11px] text-zinc-300">{type}</span>
              </div>
              <span className="font-mono text-[11px] text-zinc-500">
                {totalMemories > 0 ? Math.round((count / totalMemories) * 100) : 0}%
              </span>
            </div>
            <div className="mt-1 font-mono text-sm text-zinc-100">{count.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div className="rounded-lg bg-zinc-900/50 p-3">
        <div className="mb-2 flex items-center justify-between text-[10px] text-zinc-500">
          <span>
            {scale === "compressed"
              ? "Readable scale reduces outlier flattening"
              : "Exact linear scale"}
          </span>
          <span className="font-mono">max {maxCount}</span>
        </div>
        <div className="flex h-40 items-end gap-1">
          {timeline.map((entry) => {
            const pct = timelineScalePct(entry.count, maxCount, scale);
            const typeEntries = sortedTimelineTypes(entry.byType);

            return (
              <div
                key={entry.date}
                className="group relative flex min-w-[6px] flex-1 flex-col justify-end"
              >
                <div
                  className="flex w-full flex-col-reverse overflow-hidden rounded-t border border-white/5"
                  style={{ height: `${pct}%` }}
                >
                  {typeEntries.map(([type, count]) => {
                    const segPct = entry.count > 0 ? (count / entry.count) * 100 : 0;
                    return (
                      <div
                        key={type}
                        className={`w-full ${TYPE_BAR_COLORS[type] || "bg-zinc-600"}`}
                        style={{ height: `${segPct}%`, minHeight: 2 }}
                      />
                    );
                  })}
                </div>

                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 group-hover:block">
                  <div className="min-w-40 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[10px] text-zinc-300 shadow-lg">
                    <div className="font-mono font-medium text-zinc-100">{entry.date}</div>
                    <div className="mb-1 text-zinc-400">{entry.count} memories</div>
                    <div className="space-y-0.5">
                      {typeEntries.slice(0, 5).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`h-2 w-2 rounded-sm ${TYPE_BAR_COLORS[type] || "bg-zinc-600"}`}
                            />
                            {type}
                          </span>
                          <span className="font-mono">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 rounded-md bg-zinc-900/30 p-2">
        {sortedTypeTotals.map(([type, count]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className={`h-2.5 w-2.5 rounded-sm ${TYPE_BAR_COLORS[type] || "bg-zinc-600"}`} />
            <span className="text-[10px] text-zinc-400">{type}</span>
            <span className="font-mono text-[10px] text-zinc-600">{count}</span>
          </div>
        ))}
      </div>

      {/* Daily breakdown table */}
      <div className="space-y-1">
        {newestFirstTimeline.map((entry) => {
          const typeEntries = sortedTimelineTypes(entry.byType);
          const dominant = dominantTimelineType(entry.byType);
          const countPct = timelineScalePct(entry.count, maxCount, scale);

          return (
            <div
              key={entry.date}
              className="grid grid-cols-[5.5rem_4.5rem_1fr_3rem] items-center gap-2 py-0.5 text-xs text-zinc-400"
            >
              <span className="font-mono text-zinc-500">{entry.date}</span>
              <span className="truncate text-[10px] text-zinc-500">
                {dominant ? (
                  <>
                    <span
                      className={`mr-1 inline-block h-2 w-2 rounded-sm ${TYPE_BAR_COLORS[dominant[0]] || "bg-zinc-600"}`}
                    />
                    {dominant[0]}{" "}
                    {entry.count > 0 ? Math.round((dominant[1] / entry.count) * 100) : 0}%
                  </>
                ) : (
                  "none"
                )}
              </span>
              <div className="relative h-4 overflow-hidden rounded bg-zinc-950">
                <div
                  className="absolute inset-y-0 left-0 rounded bg-zinc-800"
                  style={{ width: `${countPct}%` }}
                />
                <div className="absolute inset-0 flex">
                  {typeEntries.map(([type, count]) => {
                    const segPct = entry.count > 0 ? (count / entry.count) * 100 : 0;
                    return (
                      <div
                        key={type}
                        title={`${type}: ${count}`}
                        className={`${TYPE_BAR_COLORS[type] || "bg-zinc-600"} opacity-85`}
                        style={{ width: `${segPct}%` }}
                      />
                    );
                  })}
                </div>
              </div>
              <span className="w-12 text-right font-mono">{entry.count}</span>
            </div>
          );
        })}
      </div>

      <button
        onClick={load}
        className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
      >
        <RefreshCw className="w-3 h-3" /> Refresh
      </button>
    </div>
  );
}
