import {
  Package,
  TrendingUp,
  Filter,
  Shield,
  Star,
  Lock,
  Award,
  Download,
  Search,
  RefreshCw,
  Wrench,
  Puzzle,
  Building2,
} from "lucide-react";
import { useState, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:9242";
const MARKETPLACE_API = "https://marketplace.argentos.ai/api/v1";

interface LicenseStatus {
  hasLicense: boolean;
  status?: string;
  tier?: string;
  orgName?: string;
}

interface CatalogItem {
  id: string;
  name: string;
  display_name: string;
  description: string;
  category: string;
  tags: string;
  author_name: string;
  author_verified: boolean;
  latest_version: string;
  total_downloads: number;
  rating: number;
  rating_count: number;
  pricing: string;
  updated_at: string;
  listed: boolean;
}

// Emoji map for known package names
const PACKAGE_ICONS: Record<string, string> = {
  "excel-tools": "📊",
  flowmind: "🔄",
  "meeting-notes": "📝",
  "mission-control": "🎯",
  "n8n-workflows": "⚡",
  "process-watch": "👁️",
  quickbooks: "💰",
  "smart-reminders": "⏰",
  salesforce: "☁️",
  "topic-monitor": "📡",
  "agent-email": "✉️",
  hubspot: "🧲",
  jira: "📋",
  "stripe-billing": "💳",
  "sysadmin-toolbox": "🔧",
  connectwise: "🔗",
  "it-glue": "📚",
  "slack-integration": "💬",
  "atera-msp": "🖥️",
};

function getIcon(name: string): string {
  return PACKAGE_ICONS[name] || "📦";
}

function parseTags(tags: string): string[] {
  try {
    return JSON.parse(tags);
  } catch {
    return [];
  }
}

function getCategoryLabel(cat: string): string {
  switch (cat) {
    case "skills":
      return "Skill";
    case "plugins":
      return "Plugin";
    case "bundles":
      return "Bundle";
    case "avatars":
      return "Avatar";
    case "templates":
      return "Template";
    default:
      return cat;
  }
}

function getCategoryIcon(cat: string) {
  switch (cat) {
    case "skills":
      return Wrench;
    case "plugins":
      return Puzzle;
    default:
      return Package;
  }
}

/**
 * MarketplaceTab - Shows real marketplace catalog from the ArgentOS Marketplace API.
 * License gated: requires valid license to view.
 */
export function MarketplaceTab() {
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Fetch license status
  useEffect(() => {
    fetch(`${API_BASE}/api/license/status`)
      .then((res) => res.json())
      .then((data) => setLicenseStatus(data))
      .catch((err) => console.error("[Marketplace] Failed to fetch license:", err))
      .finally(() => setLoading(false));
  }, []);

  // Check if license is valid
  const hasValidLicense = licenseStatus?.hasLicense && licenseStatus?.status === "active";

  // Fetch catalog — always load public catalog; licensed users also get org-private packages
  useEffect(() => {
    // Wait until license status has loaded (or failed) before fetching catalog
    if (loading) return;

    setCatalogLoading(true);
    setCatalogError(null);

    const fetchCatalog = async () => {
      try {
        let url = `${MARKETPLACE_API}/catalog?limit=50`;

        // If licensed, try the licensed endpoint for org-private packages too
        if (hasValidLicense) {
          try {
            const keyRes = await fetch(`${API_BASE}/api/license/key`);
            if (keyRes.ok) {
              const keyData = await keyRes.json();
              if (keyData?.key) {
                url = `${MARKETPLACE_API}/catalog/licensed?key=${encodeURIComponent(keyData.key)}&limit=50`;
              }
            }
          } catch {
            // Fall through to public catalog
          }
        }

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setCatalog(data.items || []);
      } catch (err) {
        console.error("[Marketplace] Failed to fetch catalog:", err);
        setCatalogError("Failed to load marketplace catalog");
      } finally {
        setCatalogLoading(false);
      }
    };

    void fetchCatalog();
  }, [loading, hasValidLicense]);

  // Filter items
  const filteredItems = catalog.filter((item) => {
    if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.display_name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        parseTags(item.tags).some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Split into org-private and public packages
  const orgItems = filteredItems.filter((i) => !i.listed);
  const publicItems = filteredItems.filter((i) => i.listed);

  // Get unique categories
  const categories = ["all", ...new Set(catalog.map((i) => i.category))];

  // Show loading state
  if (loading) {
    return (
      <div className="space-y-4">
        <p className="text-white/50 text-sm">Loading marketplace...</p>
      </div>
    );
  }

  // Show marketplace content — public catalog is always visible, org-private requires license
  return (
    <div className="space-y-4">
      {/* Header with license badge */}
      <div className="flex items-center justify-between">
        <p className="text-white/50 text-sm">
          Browse and install skills, extensions, and plugins from the ArgentOS Marketplace.
        </p>
        {licenseStatus?.orgName && (
          <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 px-3 py-1 rounded-full">
            <Shield className="w-3 h-3 text-green-400" />
            <span className="text-green-400 text-xs font-medium">{licenseStatus.orgName}</span>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
        <input
          type="text"
          placeholder="Search marketplace..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
        />
      </div>

      {/* Category Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-white/40" />
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
              categoryFilter === cat
                ? "bg-purple-500 text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            {cat === "all"
              ? `All (${catalog.length})`
              : `${getCategoryLabel(cat)} (${catalog.filter((i) => i.category === cat).length})`}
          </button>
        ))}
      </div>

      {/* Loading / Error */}
      {catalogLoading && (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="w-5 h-5 text-purple-400 animate-spin" />
          <span className="ml-2 text-white/50 text-sm">Loading catalog...</span>
        </div>
      )}

      {catalogError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center">
          <p className="text-red-400 text-sm">{catalogError}</p>
          <button
            onClick={() => {
              setCatalogLoading(true);
              setCatalogError(null);
              fetch(`${MARKETPLACE_API}/catalog`)
                .then((r) => r.json())
                .then((d) => setCatalog(d.items || []))
                .catch(() => setCatalogError("Still unable to reach marketplace"))
                .finally(() => setCatalogLoading(false));
            }}
            className="mt-2 text-purple-400 hover:text-purple-300 text-sm underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Organization Packages */}
      {!catalogLoading && !catalogError && orgItems.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-400" />
            <span className="text-white font-medium text-sm">
              {licenseStatus?.orgName?.trim() || "Your Organization"}
            </span>
            <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">
              {orgItems.length} private
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {orgItems.map((item) => (
              <PackageCard key={item.id} item={item} isOrgPrivate />
            ))}
          </div>
        </div>
      )}

      {/* Public Marketplace */}
      {!catalogLoading && !catalogError && publicItems.length > 0 && (
        <div className="space-y-3">
          {orgItems.length > 0 && (
            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
              <Package className="w-4 h-4 text-purple-400" />
              <span className="text-white font-medium text-sm">Public Marketplace</span>
              <span className="text-xs bg-white/10 text-white/50 px-2 py-0.5 rounded-full">
                {publicItems.length}
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {publicItems.map((item) => (
              <PackageCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!catalogLoading && !catalogError && filteredItems.length === 0 && catalog.length > 0 && (
        <div className="text-center py-8">
          <Package className="w-10 h-10 text-white/20 mx-auto mb-2" />
          <p className="text-white/40 text-sm">No items match your search</p>
        </div>
      )}

      {/* Stats footer */}
      {catalog.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-white/30 pt-2 border-t border-white/5">
          <TrendingUp className="w-3 h-3" />
          <span>{catalog.length} packages available on marketplace.argentos.ai</span>
        </div>
      )}
    </div>
  );
}

// ─── Package Card ────────────────────────────────────────────

function PackageCard({ item, isOrgPrivate }: { item: CatalogItem; isOrgPrivate?: boolean }) {
  const CatIcon = getCategoryIcon(item.category);
  const tags = parseTags(item.tags);

  return (
    <div
      className={`hover:bg-white/10 border rounded-lg p-3 transition-all ${
        isOrgPrivate
          ? "bg-blue-500/5 border-blue-500/20 hover:border-blue-400/40"
          : "bg-white/5 border-white/10 hover:border-purple-500/30"
      }`}
    >
      <div className="flex items-start gap-3 mb-2">
        <div className="text-2xl">{getIcon(item.name)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-white font-medium text-sm truncate">{item.display_name}</h4>
            {isOrgPrivate && (
              <span className="flex items-center gap-1 text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full flex-shrink-0">
                <Building2 className="w-2.5 h-2.5" />
                Private
              </span>
            )}
            {item.author_verified && <Shield className="w-3 h-3 text-green-400 flex-shrink-0" />}
          </div>
          <p className="text-white/50 text-xs line-clamp-2">{item.description}</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3 text-white/40">
          <div className="flex items-center gap-1">
            <CatIcon className="w-3 h-3" />
            <span>{getCategoryLabel(item.category)}</span>
          </div>
          <span>v{item.latest_version}</span>
          {item.total_downloads > 0 && (
            <div className="flex items-center gap-1">
              <Download className="w-3 h-3" />
              <span>{item.total_downloads}</span>
            </div>
          )}
          {item.rating > 0 && (
            <div className="flex items-center gap-1">
              <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
              <span>{item.rating}</span>
            </div>
          )}
        </div>
        <span className={`font-medium ${isOrgPrivate ? "text-blue-400" : "text-green-400"}`}>
          {isOrgPrivate ? "Enterprise" : item.pricing === "free" ? "Free" : item.pricing}
        </span>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                isOrgPrivate ? "bg-blue-500/15 text-blue-300" : "bg-purple-500/15 text-purple-300"
              }`}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
