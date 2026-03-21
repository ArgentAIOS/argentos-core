/**
 * Canvas Document Browser — macOS Finder-style document manager
 *
 * Modeled after macOS Finder dark mode with site-matched colors:
 * - Left sidebar with section groups (Favorites, Types, Locations)
 * - Main area with list view (Name, Date Modified, Size, Kind columns)
 * - Toolbar with search, view toggle, new button
 * - Status bar with item count
 */

import {
  Folder,
  FolderOpen,
  FileText,
  Code,
  Database,
  Globe,
  Search,
  LayoutGrid,
  List,
  Plus,
  Trash2,
  Clock,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import type { CanvasDocument } from "./CanvasPanel";
import {
  loadCanvasIndex,
  loadCanvasDocument,
  readCanvasIndexCache,
  searchDocuments,
  deleteCanvasDocument,
} from "../utils/canvasStorage";

type CanvasDocumentBrowserProps = {
  isOpen: boolean;
  onClose: () => void;
  onLoadDocument: (doc: CanvasDocument) => void;
  onNewDocument?: () => void;
};

type ViewMode = "icons" | "list";
type SidebarFilter = "all" | "recent" | "documents" | "code" | "data" | `tag:${string}` | string;
type SortKey = "name" | "date" | "size" | "kind";
type SortDir = "asc" | "desc";

interface DocEntry {
  id: string;
  title: string;
  type: string;
  savedAt: string;
  tags?: string[];
  score?: number;
  folder?: string;
  size?: number;
}

const KIND_LABELS: Record<string, string> = {
  markdown: "Document",
  code: "Source Code",
  data: "Data File",
  html: "Web Page",
};

/** Rotating palette of macOS-style tag colors */
const TAG_COLORS = [
  "bg-red-400",
  "bg-orange-400",
  "bg-yellow-400",
  "bg-green-400",
  "bg-blue-400",
  "bg-purple-400",
  "bg-pink-400",
  "bg-teal-400",
] as const;

function tagColor(index: number): string {
  return TAG_COLORS[index % TAG_COLORS.length];
}

function getDocIcon(type: string, className = "w-4 h-4") {
  switch (type) {
    case "code":
      return <Code className={`${className} text-emerald-400`} />;
    case "data":
      return <Database className={`${className} text-amber-400`} />;
    case "html":
      return <Globe className={`${className} text-blue-400`} />;
    default:
      return <FileText className={`${className} text-purple-400`} />;
  }
}

function extractFolders(docs: DocEntry[]): string[] {
  const folders = new Set<string>();
  docs.forEach((doc) => {
    if (doc.folder) folders.add(doc.folder);
    if (doc.title.includes("/")) {
      const parts = doc.title.split("/");
      if (parts.length > 1) folders.add(parts[0]);
    }
  });
  return [...folders].sort();
}

/** Deduplicate documents by ID, keeping the most recently saved version */
function deduplicateById(docs: DocEntry[]): DocEntry[] {
  const map = new Map<string, DocEntry>();
  for (const doc of docs) {
    const existing = map.get(doc.id);
    if (!existing || new Date(doc.savedAt) > new Date(existing.savedAt)) {
      map.set(doc.id, doc);
    }
  }
  return [...map.values()];
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return "Today, " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (days === 1) {
    return "Yesterday, " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "--";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CanvasDocumentBrowser({
  isOpen,
  onClose,
  onLoadDocument,
  onNewDocument,
}: CanvasDocumentBrowserProps) {
  const [documents, setDocuments] = useState<DocEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>("all");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const loadDocs = useCallback(async () => {
    const cached = deduplicateById(readCanvasIndexCache() as DocEntry[]);
    if (cached.length > 0) {
      setDocuments(cached);
    }
    setLoading(true);
    setLoadError(null);
    try {
      // Fast first paint: fetch a smaller index, then hydrate full list in background.
      const docs = await Promise.race<DocEntry[] | never>([
        loadCanvasIndex(120) as Promise<DocEntry[]>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Canvas document load timed out")), 10000),
        ),
      ]);
      const quickList = deduplicateById(Array.isArray(docs) ? docs : []);
      setDocuments(quickList.length > 0 ? quickList : cached);

      void (async () => {
        try {
          const fullDocs = await loadCanvasIndex(500);
          const fullList = deduplicateById(Array.isArray(fullDocs) ? fullDocs : []);
          if (fullList.length > quickList.length) {
            setDocuments(fullList);
          }
        } catch {
          // Keep the quick list if background hydration fails.
        }
      })();
    } catch (err) {
      console.error("[CanvasBrowser] Failed to load docs:", err);
      setDocuments([]);
      setLoadError("Could not load documents. Please retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadDocs();
      setSelectedDocId(null);
      setSearchQuery("");
    }
  }, [isOpen, loadDocs]);

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      await loadDocs();
      return;
    }
    setSearching(true);
    setLoadError(null);
    try {
      const results = await searchDocuments(query, "hybrid");
      setDocuments(deduplicateById(Array.isArray(results) ? results : []));
    } catch (err) {
      console.error("[CanvasBrowser] Search failed:", err);
      setLoadError("Search failed. Try again.");
    } finally {
      setSearching(false);
    }
  };

  const handleDelete = async (id: string) => {
    const success = await deleteCanvasDocument(id, false);
    if (success) {
      if (searchQuery) {
        handleSearch(searchQuery);
      } else {
        loadDocs();
      }
      if (selectedDocId === id) setSelectedDocId(null);
    }
  };

  const handleOpen = async (id: string) => {
    const doc = await loadCanvasDocument(id);
    if (doc) {
      onLoadDocument({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        type: doc.type,
        language: doc.language,
        createdAt: new Date(doc.savedAt),
      });
      onClose();
    }
  };

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir(key === "name" ? "asc" : "desc");
      }
    },
    [sortKey],
  );

  const folders = useMemo(() => extractFolders(documents), [documents]);

  const uniqueTags = useMemo(() => {
    const tags = new Map<string, number>();
    documents.forEach((doc) => {
      doc.tags?.forEach((tag) => {
        if (tag) tags.set(tag, (tags.get(tag) || 0) + 1);
      });
    });
    return [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [documents]);

  const filteredDocs = useMemo(() => {
    let filtered = documents;

    switch (sidebarFilter) {
      case "all":
        break;
      case "recent": {
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        filtered = filtered.filter((d) => new Date(d.savedAt).getTime() > weekAgo);
        break;
      }
      case "documents":
        filtered = filtered.filter((d) => d.type === "markdown");
        break;
      case "code":
        filtered = filtered.filter((d) => d.type === "code");
        break;
      case "data":
        filtered = filtered.filter((d) => d.type === "data" || d.type === "html");
        break;
      default:
        if (sidebarFilter.startsWith("tag:")) {
          const tag = sidebarFilter.slice(4);
          filtered = filtered.filter((d) => d.tags?.includes(tag));
        } else {
          filtered = filtered.filter(
            (d) => d.folder === sidebarFilter || d.title.startsWith(sidebarFilter + "/"),
          );
        }
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.title.localeCompare(b.title);
          break;
        case "date":
          cmp = new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime();
          break;
        case "size":
          cmp = (a.size || 0) - (b.size || 0);
          break;
        case "kind":
          cmp = (KIND_LABELS[a.type] || a.type).localeCompare(KIND_LABELS[b.type] || b.type);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [documents, sidebarFilter, sortKey, sortDir]);

  if (!isOpen) return null;

  const SortIndicator = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) {
      return <ArrowUpDown className="w-3 h-3 text-white/20" />;
    }
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 text-white/50" />
    ) : (
      <ChevronDown className="w-3 h-3 text-white/50" />
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" onClick={onClose} />

      {/* Finder Window */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[860px] max-w-[92vw] h-[560px] max-h-[80vh] bg-gray-900 border border-white/10 rounded-xl z-50 flex flex-col shadow-2xl overflow-hidden">
        {/* Title Bar */}
        <div className="flex items-center h-[38px] px-4 bg-gray-800/80 border-b border-white/10 shrink-0">
          {/* Traffic lights */}
          <div className="flex items-center gap-2 mr-4">
            <button
              onClick={onClose}
              className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-110 transition"
              title="Close"
            />
            <div className="w-3 h-3 rounded-full bg-[#febc2e] opacity-50" />
            <div className="w-3 h-3 rounded-full bg-[#28c840] opacity-50" />
          </div>

          {/* Title centered */}
          <div className="flex-1 flex items-center justify-center">
            <span className="text-white/70 text-[13px] font-medium">Documents</span>
          </div>

          {/* Right toolbar */}
          <div className="flex items-center gap-1.5">
            {onNewDocument && (
              <button
                onClick={() => {
                  onNewDocument();
                  onClose();
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/10 text-white/60 hover:text-purple-300 text-xs transition-colors"
                title="New Document"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
            <div className="w-px h-4 bg-white/10 mx-0.5" />
            <button
              onClick={() => setViewMode("icons")}
              className={`p-1 rounded transition-colors ${viewMode === "icons" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}
              title="Icon view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1 rounded transition-colors ${viewMode === "list" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}
              title="List view"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-white/10 mx-0.5" />
            {/* Search */}
            <div className="relative w-44">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
              <input
                type="text"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value.trim()) {
                    void handleSearch(e.target.value);
                  } else {
                    void loadDocs();
                  }
                }}
                className="w-full pl-7 pr-2 py-1 bg-gray-800/60 border border-white/10 rounded-md text-white text-xs placeholder-white/30 focus:outline-none focus:border-purple-500/50"
              />
              {searching && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 border border-purple-400/50 border-t-purple-400 rounded-full animate-spin" />
              )}
            </div>
          </div>
        </div>

        {/* Body: Sidebar + Content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-[170px] bg-gray-800/40 border-r border-white/10 py-2 overflow-y-auto shrink-0">
            {/* Favorites */}
            <div className="px-4 py-1 text-[10px] font-semibold text-white/30 uppercase tracking-wider">
              Favorites
            </div>
            <SidebarItem
              icon={<Folder className="w-[15px] h-[15px] text-blue-400" />}
              label="All Documents"
              active={sidebarFilter === "all"}
              onClick={() => setSidebarFilter("all")}
              count={documents.length}
            />
            <SidebarItem
              icon={<Clock className="w-[15px] h-[15px] text-purple-400" />}
              label="Recents"
              active={sidebarFilter === "recent"}
              onClick={() => setSidebarFilter("recent")}
            />

            {/* Types */}
            <div className="px-4 py-1 mt-3 text-[10px] font-semibold text-white/30 uppercase tracking-wider">
              Types
            </div>
            <SidebarItem
              icon={<FileText className="w-[15px] h-[15px] text-purple-400" />}
              label="Documents"
              active={sidebarFilter === "documents"}
              onClick={() => setSidebarFilter("documents")}
              count={documents.filter((d) => d.type === "markdown").length}
            />
            <SidebarItem
              icon={<Code className="w-[15px] h-[15px] text-emerald-400" />}
              label="Code"
              active={sidebarFilter === "code"}
              onClick={() => setSidebarFilter("code")}
              count={documents.filter((d) => d.type === "code").length}
            />
            <SidebarItem
              icon={<Database className="w-[15px] h-[15px] text-amber-400" />}
              label="Data & HTML"
              active={sidebarFilter === "data"}
              onClick={() => setSidebarFilter("data")}
              count={documents.filter((d) => d.type === "data" || d.type === "html").length}
            />

            {/* Folders */}
            {folders.length > 0 && (
              <>
                <div className="px-4 py-1 mt-3 text-[10px] font-semibold text-white/30 uppercase tracking-wider">
                  Locations
                </div>
                {folders.map((folder) => (
                  <SidebarItem
                    key={folder}
                    icon={
                      sidebarFilter === folder ? (
                        <FolderOpen className="w-[15px] h-[15px] text-blue-400" />
                      ) : (
                        <Folder className="w-[15px] h-[15px] text-blue-400" />
                      )
                    }
                    label={folder}
                    active={sidebarFilter === folder}
                    onClick={() => setSidebarFilter(folder)}
                  />
                ))}
              </>
            )}

            {/* Tags */}
            {uniqueTags.length > 0 && (
              <>
                <div className="px-4 py-1 mt-3 text-[10px] font-semibold text-white/30 uppercase tracking-wider">
                  Tags
                </div>
                {uniqueTags.map(([tag, count], i) => (
                  <SidebarItem
                    key={tag}
                    icon={
                      <span className={`w-[10px] h-[10px] rounded-full ${tagColor(i)} shrink-0`} />
                    }
                    label={tag}
                    active={sidebarFilter === `tag:${tag}`}
                    onClick={() => setSidebarFilter(`tag:${tag}`)}
                    count={count}
                  />
                ))}
              </>
            )}

            {/* New Document button at bottom of sidebar */}
            {onNewDocument && (
              <div className="mt-4 px-3">
                <button
                  onClick={() => {
                    onNewDocument();
                    onClose();
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-xs font-medium transition-colors border border-purple-500/20"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Document
                </button>
              </div>
            )}
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col min-h-0 bg-gray-900">
            {loading && documents.length === 0 ? (
              <div className="flex items-center justify-center h-full text-white/40">
                <div className="w-5 h-5 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin mr-3" />
                Loading...
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center justify-center h-full text-white/50">
                <p className="text-sm">{loadError}</p>
                <button
                  onClick={() => void loadDocs()}
                  className="mt-3 px-3 py-1.5 rounded-md bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-xs transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : filteredDocs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-white/40">
                <Folder className="w-14 h-14 mb-3 text-white/10" />
                <p className="text-sm mb-1">
                  {searchQuery ? "No documents found" : "No documents yet"}
                </p>
                {onNewDocument && !searchQuery && (
                  <button
                    onClick={() => {
                      onNewDocument();
                      onClose();
                    }}
                    className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-xs transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Create Document
                  </button>
                )}
              </div>
            ) : viewMode === "list" ? (
              /* ===== List View (Finder-style) ===== */
              <div className="flex flex-col flex-1 min-h-0">
                {/* Column Headers */}
                <div className="flex items-center h-[25px] px-3 bg-gray-800/60 border-b border-white/10 text-[11px] text-white/40 shrink-0 select-none">
                  <button
                    className="flex items-center gap-1 flex-1 min-w-0 hover:text-white/70 transition-colors text-left"
                    onClick={() => handleSort("name")}
                  >
                    Name <SortIndicator column="name" />
                  </button>
                  <button
                    className="flex items-center gap-1 w-[160px] shrink-0 hover:text-white/70 transition-colors text-left"
                    onClick={() => handleSort("date")}
                  >
                    Date Modified <SortIndicator column="date" />
                  </button>
                  <button
                    className="flex items-center gap-1 w-[70px] shrink-0 hover:text-white/70 transition-colors text-right justify-end"
                    onClick={() => handleSort("size")}
                  >
                    Size <SortIndicator column="size" />
                  </button>
                  <button
                    className="flex items-center gap-1 w-[100px] shrink-0 hover:text-white/70 transition-colors text-left pl-4"
                    onClick={() => handleSort("kind")}
                  >
                    Kind <SortIndicator column="kind" />
                  </button>
                  <div className="w-[28px] shrink-0" />
                </div>

                {/* Rows */}
                <div className="flex-1 overflow-y-auto">
                  {filteredDocs.map((doc, i) => (
                    <div
                      key={doc.id}
                      className={`group flex items-center h-[28px] px-3 text-[13px] cursor-default transition-colors ${
                        selectedDocId === doc.id
                          ? "bg-purple-500/20 text-white"
                          : i % 2 === 0
                            ? "bg-gray-900 text-white/80 hover:bg-white/5"
                            : "bg-gray-800/20 text-white/80 hover:bg-white/5"
                      }`}
                      onClick={() => setSelectedDocId(doc.id)}
                      onDoubleClick={() => handleOpen(doc.id)}
                    >
                      {/* Name */}
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {getDocIcon(doc.type, "w-[15px] h-[15px]")}
                        <span className="truncate">{doc.title}</span>
                      </div>
                      {/* Date Modified */}
                      <span className="w-[160px] shrink-0 text-white/40 text-[12px] truncate">
                        {formatDate(doc.savedAt)}
                      </span>
                      {/* Size */}
                      <span className="w-[70px] shrink-0 text-white/40 text-[12px] text-right">
                        {formatSize(doc.size)}
                      </span>
                      {/* Kind */}
                      <span className="w-[100px] shrink-0 text-white/40 text-[12px] pl-4 truncate">
                        {KIND_LABELS[doc.type] || doc.type}
                      </span>
                      {/* Delete */}
                      <div className="w-[28px] shrink-0 flex justify-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(doc.id);
                          }}
                          className="p-0.5 rounded hover:bg-red-500/20 text-transparent group-hover:text-white/30 hover:!text-red-400 transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* ===== Icon Grid View ===== */
              <div className="flex-1 overflow-y-auto p-4">
                <div className="grid grid-cols-5 gap-2">
                  {filteredDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className={`group flex flex-col items-center p-3 rounded-lg cursor-default transition-all ${
                        selectedDocId === doc.id
                          ? "bg-purple-500/20 ring-1 ring-purple-500/40"
                          : "hover:bg-white/5"
                      }`}
                      onClick={() => setSelectedDocId(doc.id)}
                      onDoubleClick={() => handleOpen(doc.id)}
                    >
                      <div className="relative mb-1.5">
                        {getDocIcon(doc.type, "w-10 h-10")}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(doc.id);
                          }}
                          className="absolute -top-1 -right-1 p-0.5 rounded-full bg-gray-900 border border-white/10 text-transparent group-hover:text-white/30 hover:!text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                      <span className="text-[12px] text-center truncate w-full leading-tight text-white/80">
                        {doc.title}
                      </span>
                      <span className="text-[10px] text-white/30 mt-0.5">
                        {formatDate(doc.savedAt).split(",")[0]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Status Bar */}
        <div className="flex items-center justify-between h-[24px] px-4 bg-gray-800/60 border-t border-white/10 text-[11px] text-white/30 shrink-0">
          <span>
            {filteredDocs.length} item{filteredDocs.length !== 1 ? "s" : ""}
            {searchQuery && ` matching "${searchQuery}"`}
          </span>
          {selectedDocId && (
            <button
              onClick={() => selectedDocId && handleOpen(selectedDocId)}
              className="px-2 py-0.5 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-[11px] transition-colors"
            >
              Open
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** Sidebar navigation item — Finder-style */
function SidebarItem({
  icon,
  label,
  active,
  onClick,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-4 py-[5px] text-[13px] transition-colors ${
        active
          ? "bg-purple-500/20 text-white"
          : "text-white/60 hover:text-white/80 hover:bg-white/5"
      }`}
    >
      {icon}
      <span className="truncate flex-1 text-left">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-white/30 text-[11px]">{count}</span>
      )}
    </button>
  );
}
