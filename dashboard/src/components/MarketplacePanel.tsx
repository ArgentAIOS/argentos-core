import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Search,
  Package,
  Puzzle,
  Wrench,
  Download,
  Star,
  // TrendingUp,
  Filter,
  Grid3x3,
  List,
  CheckCircle,
  ExternalLink,
  Shield,
  Clock,
  Users,
  AlertCircle,
} from "lucide-react";
import { useState, useMemo } from "react";

// ============================================================================
// Types
// ============================================================================

export type MarketplaceItemType = "skill" | "extension" | "plugin";
export type MarketplaceCategoryFilter = "all" | MarketplaceItemType;
export type MarketplaceSortBy = "popular" | "newest" | "rating" | "name";
export type MarketplaceViewMode = "grid" | "list";

export interface MarketplaceItem {
  id: string;
  name: string;
  type: MarketplaceItemType;
  description: string;
  longDescription?: string;
  version: string;
  author: string;
  downloads: number;
  rating: number;
  ratingCount: number;
  tags: string[];
  category?: string;
  verified: boolean;
  requiresLicense: boolean;
  installed: boolean;
  updatedAt: string; // ISO date string
  icon?: string;
  homepage?: string;
}

interface MarketplacePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================================================
// Mock Data
// ============================================================================

const MOCK_MARKETPLACE_ITEMS: MarketplaceItem[] = [
  {
    id: "skill-web-search",
    name: "Web Search",
    type: "skill",
    description: "Search the web using multiple search engines with smart aggregation",
    longDescription:
      "Advanced web search skill with support for Google, Bing, and DuckDuckGo. Includes automatic result deduplication, relevance scoring, and smart summarization.",
    version: "2.1.0",
    author: "ArgentOS Team",
    downloads: 15420,
    rating: 4.8,
    ratingCount: 342,
    tags: ["search", "web", "research"],
    category: "Information",
    verified: true,
    requiresLicense: false,
    installed: true,
    updatedAt: "2026-02-05T10:30:00Z",
    icon: "🔍",
  },
  {
    id: "skill-code-review",
    name: "Code Review Assistant",
    type: "skill",
    description: "Automated code review with security scanning and best practices",
    longDescription:
      "Professional code review assistant that analyzes your code for security vulnerabilities, performance issues, and adherence to best practices. Supports 20+ languages.",
    version: "1.5.2",
    author: "DevTools Community",
    downloads: 8932,
    rating: 4.9,
    ratingCount: 187,
    tags: ["code", "review", "security", "development"],
    category: "Development",
    verified: true,
    requiresLicense: true,
    installed: false,
    updatedAt: "2026-02-01T14:20:00Z",
    icon: "💻",
  },
  {
    id: "ext-voice-commands",
    name: "Advanced Voice Commands",
    type: "extension",
    description: "Custom wake words and voice command processing",
    longDescription:
      "Extend voice capabilities with custom wake words, voice profiles, and advanced command processing. Includes noise cancellation and multi-language support.",
    version: "3.0.1",
    author: "Voice AI Labs",
    downloads: 12304,
    rating: 4.7,
    ratingCount: 256,
    tags: ["voice", "speech", "commands", "wake-word"],
    category: "Voice & Audio",
    verified: true,
    requiresLicense: true,
    installed: false,
    updatedAt: "2026-01-28T09:15:00Z",
    icon: "🎤",
  },
  {
    id: "plugin-slack-integration",
    name: "Slack Pro",
    type: "plugin",
    description: "Enhanced Slack integration with message threading and file sharing",
    longDescription:
      "Professional Slack integration with support for threaded conversations, file attachments, reactions, and custom emojis. Includes workspace management and channel monitoring.",
    version: "2.3.0",
    author: "Communication Tools Inc",
    downloads: 6742,
    rating: 4.6,
    ratingCount: 143,
    tags: ["slack", "communication", "messaging", "collaboration"],
    category: "Communication",
    verified: true,
    requiresLicense: false,
    installed: true,
    updatedAt: "2026-02-08T16:45:00Z",
    icon: "💬",
  },
  {
    id: "skill-data-analysis",
    name: "Data Analysis Pro",
    type: "skill",
    description: "Advanced data analysis with visualization and statistical modeling",
    longDescription:
      "Professional data analysis toolkit with support for CSV, JSON, Excel files. Includes statistical modeling, data visualization, and automated reporting.",
    version: "1.8.4",
    author: "DataSci Tools",
    downloads: 4521,
    rating: 4.9,
    ratingCount: 98,
    tags: ["data", "analysis", "statistics", "visualization"],
    category: "Data & Analytics",
    verified: true,
    requiresLicense: true,
    installed: false,
    updatedAt: "2026-02-04T11:30:00Z",
    icon: "📊",
  },
  {
    id: "ext-calendar-sync",
    name: "Calendar Sync",
    type: "extension",
    description: "Two-way sync with Google Calendar, Outlook, and iCloud",
    longDescription:
      "Keep your calendars in sync across all platforms. Supports Google Calendar, Microsoft Outlook, and Apple iCloud with automatic conflict resolution.",
    version: "2.0.0",
    author: "ArgentOS Team",
    downloads: 9845,
    rating: 4.5,
    ratingCount: 221,
    tags: ["calendar", "sync", "scheduling", "productivity"],
    category: "Productivity",
    verified: true,
    requiresLicense: false,
    installed: false,
    updatedAt: "2026-01-30T08:00:00Z",
    icon: "📅",
  },
  {
    id: "plugin-discord-rich",
    name: "Discord Rich Presence",
    type: "plugin",
    description: "Rich Discord integration with embeds and custom status",
    longDescription:
      "Enhanced Discord plugin with support for rich embeds, custom status updates, voice channel integration, and role management.",
    version: "1.2.3",
    author: "Gaming Community",
    downloads: 11230,
    rating: 4.7,
    ratingCount: 289,
    tags: ["discord", "gaming", "communication", "status"],
    category: "Communication",
    verified: false,
    requiresLicense: false,
    installed: false,
    updatedAt: "2026-02-06T13:20:00Z",
    icon: "🎮",
  },
  {
    id: "skill-pdf-processing",
    name: "PDF Pro",
    type: "skill",
    description: "Extract, analyze, and generate PDF documents",
    longDescription:
      "Complete PDF toolkit for extraction, analysis, and generation. Supports OCR, text extraction, metadata editing, and PDF generation from multiple formats.",
    version: "3.1.0",
    author: "Document Tools",
    downloads: 7856,
    rating: 4.8,
    ratingCount: 167,
    tags: ["pdf", "documents", "ocr", "text-extraction"],
    category: "Documents",
    verified: true,
    requiresLicense: true,
    installed: false,
    updatedAt: "2026-02-07T15:10:00Z",
    icon: "📄",
  },
  {
    id: "ext-clipboard-manager",
    name: "Smart Clipboard",
    type: "extension",
    description: "Intelligent clipboard history with search and formatting",
    longDescription:
      "Never lose clipboard content again. Smart clipboard manager with history, search, automatic formatting detection, and cloud sync.",
    version: "1.4.0",
    author: "Productivity Suite",
    downloads: 5632,
    rating: 4.6,
    ratingCount: 124,
    tags: ["clipboard", "productivity", "history", "sync"],
    category: "Productivity",
    verified: true,
    requiresLicense: false,
    installed: false,
    updatedAt: "2026-01-25T12:40:00Z",
    icon: "📋",
  },
  {
    id: "plugin-github-actions",
    name: "GitHub Actions Runner",
    type: "plugin",
    description: "Trigger and monitor GitHub Actions workflows",
    longDescription:
      "Integrate with GitHub Actions to trigger workflows, monitor runs, view logs, and manage repository automation directly from ArgentOS.",
    version: "2.2.1",
    author: "DevOps Tools",
    downloads: 3421,
    rating: 4.9,
    ratingCount: 76,
    tags: ["github", "ci-cd", "automation", "devops"],
    category: "Development",
    verified: true,
    requiresLicense: false,
    installed: true,
    updatedAt: "2026-02-09T07:30:00Z",
    icon: "⚙️",
  },
  {
    id: "skill-translation",
    name: "Universal Translator",
    type: "skill",
    description: "Real-time translation for 100+ languages",
    longDescription:
      "Professional translation service supporting 100+ languages with context-aware translations, dialect detection, and cultural adaptation.",
    version: "1.9.0",
    author: "Language AI",
    downloads: 14567,
    rating: 4.7,
    ratingCount: 412,
    tags: ["translation", "language", "multilingual", "i18n"],
    category: "Language",
    verified: true,
    requiresLicense: true,
    installed: false,
    updatedAt: "2026-02-03T10:20:00Z",
    icon: "🌍",
  },
  {
    id: "ext-task-templates",
    name: "Task Templates",
    type: "extension",
    description: "Pre-built task templates for common workflows",
    longDescription:
      "Speed up your work with pre-built task templates for software development, content creation, research, and more. Includes 50+ templates.",
    version: "1.3.0",
    author: "Workflow Experts",
    downloads: 6234,
    rating: 4.5,
    ratingCount: 145,
    tags: ["tasks", "templates", "workflow", "automation"],
    category: "Productivity",
    verified: true,
    requiresLicense: false,
    installed: false,
    updatedAt: "2026-01-29T14:15:00Z",
    icon: "📝",
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

function getTypeIcon(type: MarketplaceItemType) {
  switch (type) {
    case "skill":
      return Wrench;
    case "extension":
      return Puzzle;
    case "plugin":
      return Package;
  }
}

function getTypeLabel(type: MarketplaceItemType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatDownloads(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

// ============================================================================
// Component
// ============================================================================

export function MarketplacePanel({ isOpen, onClose }: MarketplacePanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<MarketplaceCategoryFilter>("all");
  const [sortBy, setSortBy] = useState<MarketplaceSortBy>("popular");
  const [viewMode, setViewMode] = useState<MarketplaceViewMode>("grid");
  const [selectedItem, setSelectedItem] = useState<MarketplaceItem | null>(null);

  // Filter and sort items
  const filteredItems = useMemo(() => {
    let items = MOCK_MARKETPLACE_ITEMS;

    // Apply category filter
    if (categoryFilter !== "all") {
      items = items.filter((item) => item.type === categoryFilter);
    }

    // Apply search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query) ||
          item.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          item.author.toLowerCase().includes(query),
      );
    }

    // Sort items
    items = [...items].sort((a, b) => {
      switch (sortBy) {
        case "popular":
          return b.downloads - a.downloads;
        case "newest":
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case "rating":
          return b.rating - a.rating;
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    return items;
  }, [searchQuery, categoryFilter, sortBy]);

  const handleInstall = (item: MarketplaceItem) => {
    if (item.requiresLicense) {
      alert(
        `Installation requires a valid license.\n\nThis is a placeholder UI. License validation and installation will be implemented in Phase 3.`,
      );
    } else {
      alert(
        `Installing ${item.name}...\n\nThis is a placeholder UI. Real installation will be implemented in Phase 3.`,
      );
    }
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[95vw] h-[90vh] max-w-[1400px] bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20">
          <div className="flex items-center gap-3">
            <Package className="w-6 h-6 text-purple-400" />
            <h2 className="text-xl font-bold text-white">Marketplace</h2>
            <span className="text-xs text-white/40 bg-white/5 px-2 py-1 rounded">
              {filteredItems.length} items
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/50 hover:text-white/80 hover:bg-white/5 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search and Filters */}
        <div className="flex-shrink-0 px-6 py-4 space-y-3 border-b border-white/10 bg-black/10">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              placeholder="Search skills, extensions, and plugins..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
            />
          </div>

          {/* Filters Row */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Category Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-white/40" />
              <div className="flex gap-1">
                {(["all", "skill", "extension", "plugin"] as const).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                      categoryFilter === cat
                        ? "bg-purple-500 text-white"
                        : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80"
                    }`}
                  >
                    {cat === "all" ? "All" : getTypeLabel(cat)}
                  </button>
                ))}
              </div>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2 ml-auto">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as MarketplaceSortBy)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500/50"
              >
                <option value="popular">Most Popular</option>
                <option value="newest">Newest</option>
                <option value="rating">Highest Rated</option>
                <option value="name">Name A-Z</option>
              </select>

              {/* View Mode Toggle */}
              <div className="flex gap-1 bg-white/5 rounded-lg p-1">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-1.5 rounded transition-all ${
                    viewMode === "grid"
                      ? "bg-purple-500 text-white"
                      : "text-white/50 hover:text-white/80"
                  }`}
                >
                  <Grid3x3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-1.5 rounded transition-all ${
                    viewMode === "list"
                      ? "bg-purple-500 text-white"
                      : "text-white/50 hover:text-white/80"
                  }`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/40">
              <Package className="w-16 h-16 mb-4" />
              <p className="text-lg">No items found</p>
              <p className="text-sm">Try adjusting your search or filters</p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredItems.map((item) => (
                <MarketplaceCard
                  key={item.id}
                  item={item}
                  onInstall={handleInstall}
                  onViewDetails={setSelectedItem}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredItems.map((item) => (
                <MarketplaceListItem
                  key={item.id}
                  item={item}
                  onInstall={handleInstall}
                  onViewDetails={setSelectedItem}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail Modal */}
        <AnimatePresence>
          {selectedItem && (
            <MarketplaceDetailModal
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
              onInstall={handleInstall}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// ============================================================================
// Grid Card Component
// ============================================================================

interface MarketplaceCardProps {
  item: MarketplaceItem;
  onInstall: (item: MarketplaceItem) => void;
  onViewDetails: (item: MarketplaceItem) => void;
}

function MarketplaceCard({ item, onInstall, onViewDetails }: MarketplaceCardProps) {
  const TypeIcon = getTypeIcon(item.type);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-500/30 rounded-xl p-4 transition-all cursor-pointer group"
      onClick={() => onViewDetails(item)}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="text-3xl">{item.icon || "📦"}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-white font-medium text-sm truncate group-hover:text-purple-400 transition-colors">
              {item.name}
            </h3>
            {item.verified && <Shield className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
          </div>
          <div className="flex items-center gap-2 text-xs text-white/40">
            <TypeIcon className="w-3 h-3" />
            <span>{getTypeLabel(item.type)}</span>
            <span>•</span>
            <span>v{item.version}</span>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-white/60 text-xs mb-3 line-clamp-2">{item.description}</p>

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs text-white/40 mb-3">
        <div className="flex items-center gap-1">
          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
          <span className="text-white/60">{item.rating}</span>
          <span>({item.ratingCount})</span>
        </div>
        <div className="flex items-center gap-1">
          <Download className="w-3 h-3" />
          <span>{formatDownloads(item.downloads)}</span>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mb-3">
        {item.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded">
            {tag}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2">
        {item.installed ? (
          <div className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 text-green-400 px-3 py-1.5 rounded-lg text-xs font-medium">
            <CheckCircle className="w-3.5 h-3.5" />
            Installed
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInstall(item);
            }}
            className="flex-1 bg-purple-500 hover:bg-purple-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            Install
          </button>
        )}
        {item.requiresLicense && (
          <div className="bg-yellow-500/20 text-yellow-400 px-2 py-1.5 rounded-lg">
            <Shield className="w-3.5 h-3.5" />
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// List Item Component
// ============================================================================

function MarketplaceListItem({ item, onInstall, onViewDetails }: MarketplaceCardProps) {
  const TypeIcon = getTypeIcon(item.type);

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-500/30 rounded-lg p-4 transition-all cursor-pointer group"
      onClick={() => onViewDetails(item)}
    >
      <div className="flex items-center gap-4">
        {/* Icon */}
        <div className="text-3xl flex-shrink-0">{item.icon || "📦"}</div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-white font-medium text-sm group-hover:text-purple-400 transition-colors">
              {item.name}
            </h3>
            {item.verified && <Shield className="w-3.5 h-3.5 text-green-400" />}
            <span className="text-xs text-white/40">v{item.version}</span>
          </div>
          <p className="text-white/60 text-xs mb-2 line-clamp-1">{item.description}</p>
          <div className="flex items-center gap-3 text-xs text-white/40">
            <div className="flex items-center gap-1">
              <TypeIcon className="w-3 h-3" />
              <span>{getTypeLabel(item.type)}</span>
            </div>
            <div className="flex items-center gap-1">
              <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
              <span className="text-white/60">{item.rating}</span>
              <span>({item.ratingCount})</span>
            </div>
            <div className="flex items-center gap-1">
              <Download className="w-3 h-3" />
              <span>{formatDownloads(item.downloads)}</span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              <span>{item.author}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{formatDate(item.updatedAt)}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {item.requiresLicense && (
            <div className="bg-yellow-500/20 text-yellow-400 px-2 py-1.5 rounded-lg">
              <Shield className="w-3.5 h-3.5" />
            </div>
          )}
          {item.installed ? (
            <div className="flex items-center gap-2 bg-green-500/20 text-green-400 px-4 py-2 rounded-lg text-xs font-medium">
              <CheckCircle className="w-3.5 h-3.5" />
              Installed
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onInstall(item);
              }}
              className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2"
            >
              <Download className="w-3.5 h-3.5" />
              Install
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// Detail Modal Component
// ============================================================================

interface MarketplaceDetailModalProps {
  item: MarketplaceItem;
  onClose: () => void;
  onInstall: (item: MarketplaceItem) => void;
}

function MarketplaceDetailModal({ item, onClose, onInstall }: MarketplaceDetailModalProps) {
  const TypeIcon = getTypeIcon(item.type);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[80vh] bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-white/20 overflow-hidden flex flex-col m-4"
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-start gap-4 px-6 py-5 border-b border-white/10 bg-black/20">
          <div className="text-5xl">{item.icon || "📦"}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-2xl font-bold text-white">{item.name}</h2>
              {item.verified && (
                <div className="flex items-center gap-1 bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs">
                  <Shield className="w-3.5 h-3.5" />
                  Verified
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-white/60 mb-2">
              <div className="flex items-center gap-1">
                <TypeIcon className="w-4 h-4" />
                <span>{getTypeLabel(item.type)}</span>
              </div>
              <span>•</span>
              <span>Version {item.version}</span>
              <span>•</span>
              <span>by {item.author}</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1">
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                <span className="text-white">{item.rating}</span>
                <span className="text-white/40">({item.ratingCount} reviews)</span>
              </div>
              <div className="flex items-center gap-1 text-white/60">
                <Download className="w-4 h-4" />
                <span>{item.downloads.toLocaleString()} downloads</span>
              </div>
              <div className="flex items-center gap-1 text-white/60">
                <Clock className="w-4 h-4" />
                <span>Updated {formatDate(item.updatedAt)}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/50 hover:text-white/80 hover:bg-white/5 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Description */}
          <div>
            <h3 className="text-white font-semibold mb-2">Description</h3>
            <p className="text-white/70 text-sm leading-relaxed">
              {item.longDescription || item.description}
            </p>
          </div>

          {/* Tags */}
          <div>
            <h3 className="text-white font-semibold mb-2">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-purple-500/20 text-purple-300 px-3 py-1 rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Requirements */}
          {item.requiresLicense && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-yellow-400 font-medium mb-1">License Required</h4>
                  <p className="text-white/70 text-sm">
                    This {item.type} requires a valid ArgentOS Pro license to install and use.
                    License validation will be performed before installation.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Additional Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-white/40 text-xs mb-1">Category</div>
              <div className="text-white text-sm">{item.category || "General"}</div>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-white/40 text-xs mb-1">Status</div>
              <div className="text-white text-sm">
                {item.installed ? (
                  <span className="text-green-400">Installed</span>
                ) : (
                  <span className="text-white/60">Not Installed</span>
                )}
              </div>
            </div>
          </div>

          {/* Links */}
          {item.homepage && (
            <div>
              <a
                href={item.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 text-sm"
              >
                <ExternalLink className="w-4 h-4" />
                Visit Homepage
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-black/20">
          <button
            onClick={onClose}
            className="px-4 py-2 text-white/70 hover:text-white hover:bg-white/5 rounded-lg transition-all"
          >
            Close
          </button>
          {item.installed ? (
            <div className="flex items-center gap-2 bg-green-500/20 text-green-400 px-4 py-2 rounded-lg font-medium">
              <CheckCircle className="w-4 h-4" />
              Installed
            </div>
          ) : (
            <button
              onClick={() => onInstall(item)}
              className="flex items-center gap-2 bg-purple-500 hover:bg-purple-600 text-white px-6 py-2 rounded-lg font-medium transition-all"
            >
              <Download className="w-4 h-4" />
              Install Now
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
