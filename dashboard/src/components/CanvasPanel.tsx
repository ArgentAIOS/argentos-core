import {
  Download,
  X as XIcon,
  Trash2,
  Pencil,
  Eye,
  Plus,
  TerminalSquare,
  Copy,
  Check,
} from "lucide-react";
import mermaid from "mermaid";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import { saveCanvasDocument } from "../utils/canvasStorage";
import { CanvasDocumentBrowser } from "./CanvasDocumentBrowser";
import { DebatePanel, type DebateState } from "./DebatePanel";
import { NewDocumentModal } from "./NewDocumentModal";
import { TerminalView } from "./TerminalView";

// Initialize Mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    primaryColor: "#a855f7",
    primaryTextColor: "#fff",
    primaryBorderColor: "#7c3aed",
    lineColor: "#6366f1",
    secondaryColor: "#1e293b",
    tertiaryColor: "#334155",
  },
});

// Resolve a local file path to a media API URL
function toMediaUrl(src: string): string {
  let resolved = src;
  if (resolved.startsWith("MEDIA:")) resolved = resolved.slice(6).trim();
  if (resolved.startsWith("file://")) resolved = resolved.replace("file://", "");
  if (
    resolved.startsWith("/var/") ||
    resolved.startsWith("/tmp/") ||
    resolved.startsWith("/Users/")
  ) {
    return `http://localhost:9242/api/media?path=${encodeURIComponent(resolved)}`;
  }
  return resolved;
}

// Download button overlay for media in doc panel
function DocMediaDownload({ mediaUrl, fileName }: { mediaUrl: string; fileName: string }) {
  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement("a");
    a.href = mediaUrl;
    a.download = fileName;
    a.click();
  };

  return (
    <button
      onClick={handleDownload}
      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-all z-10 backdrop-blur-sm flex items-center gap-1"
      title="Save to Disk"
    >
      <Download className="w-4 h-4" />
      <span className="text-xs">Save</span>
    </button>
  );
}

// Delete confirmation dialog
function DeleteConfirmDialog({
  docTitle,
  onDeleteDoc,
  onDeleteAll,
  onCancel,
}: {
  docTitle: string;
  onDeleteDoc: () => void;
  onDeleteAll: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-gray-800 border border-white/10 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-red-500/20">
            <Trash2 className="w-5 h-5 text-red-400" />
          </div>
          <h3 className="text-white font-semibold text-lg">Delete Document</h3>
        </div>
        <p className="text-white/70 mb-6">
          Delete <span className="text-white font-medium">"{docTitle}"</span>?
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onDeleteAll}
            className="w-full px-4 py-2.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-all text-sm font-medium border border-red-500/20"
          >
            Delete document and media files
          </button>
          <button
            onClick={onDeleteDoc}
            className="w-full px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all text-sm font-medium border border-white/10"
          >
            Delete document only
          </button>
          <button
            onClick={onCancel}
            className="w-full px-4 py-2.5 rounded-lg text-white/40 hover:text-white/60 transition-all text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export type CanvasDocument = {
  id: string;
  title: string;
  content: string;
  type: "markdown" | "code" | "data" | "html" | "terminal" | "debate";
  language?: string; // for code blocks
  terminalId?: string; // for terminal type
  createdAt: Date;
};

type CanvasPanelProps = {
  isOpen: boolean;
  documents: CanvasDocument[];
  activeDocId?: string;
  onClose: () => void;
  onDocumentChange?: (docId: string) => void;
  onDeleteDocument?: (docId: string, deleteMedia: boolean) => void;
  onCloseTab?: (docId: string) => void;
  onDownload?: (doc: CanvasDocument) => void;
  onSaveAsPDF?: (doc: CanvasDocument) => void;
  onSaveAsDoc?: (doc: CanvasDocument) => void;
  onEmail?: (doc: CanvasDocument) => void;
  onCreateDocument?: (doc: {
    title: string;
    description: string;
    type: "markdown" | "code" | "data";
    language?: string;
    folder?: string;
  }) => void;
  /** Gateway connection for terminal I/O */
  gateway?: {
    request: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
    on: (event: string, handler: (payload: unknown) => void) => () => void;
    connected: boolean;
  };
  /** Callback when user clicks New Terminal button */
  onNewTerminal?: () => void;
  /** Debate state for rendering Think Tank inside the panel */
  debateState?: DebateState;
  // Debug positioning
  left?: number;
  width?: number;
  top?: number;
};

// Mermaid component for rendering diagrams
function MermaidDiagram({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      mermaid
        .render(id, chart)
        .then(({ svg }) => {
          if (ref.current) {
            ref.current.innerHTML = svg;
          }
        })
        .catch((err) => {
          console.error("[Mermaid] Render error:", err);
          if (ref.current) {
            ref.current.innerHTML = `<pre class="text-red-400">Mermaid diagram error: ${err.message}</pre>`;
          }
        });
    }
  }, [chart]);

  return <div ref={ref} className="my-4" />;
}

export function CanvasPanel({
  isOpen,
  documents,
  activeDocId,
  onClose,
  onDocumentChange,
  onDeleteDocument,
  onCloseTab,
  onDownload,
  onSaveAsPDF,
  onSaveAsDoc,
  onEmail,
  onCreateDocument,
  gateway,
  onNewTerminal,
  debateState,
  left = 35,
  width = 40,
  top = 5,
}: CanvasPanelProps) {
  const activeDoc = documents.find((d) => d.id === activeDocId) || documents[0];
  const [browserOpen, setBrowserOpen] = useState(false);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [deleteConfirmDocId, setDeleteConfirmDocId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [copiedTerminalId, setCopiedTerminalId] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);

  // Reset edit mode when switching documents
  useEffect(() => {
    setEditMode(false);
    setEditContent("");
  }, [activeDocId]);

  // Save scroll position on scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      scrollPositionRef.current = container.scrollTop;
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Restore scroll position after render
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container && scrollPositionRef.current > 0) {
      container.scrollTop = scrollPositionRef.current;
    }
  });

  // Auto-save disabled - was causing glitches
  // Documents are saved via the pushToCanvas mechanism instead
  // useEffect(() => {
  //   if (activeDoc && isOpen) {
  //     const timer = setTimeout(() => {
  //       saveCanvasDocument(activeDoc).catch(err => {
  //         console.error('[Canvas] Auto-save failed:', err)
  //       })
  //     }, 2000)
  //     return () => clearTimeout(timer)
  //   }
  // }, [activeDoc, isOpen])

  const handleDownload = () => {
    if (!activeDoc) return;
    const blob = new Blob([activeDoc.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeDoc.title}.${activeDoc.type === "markdown" ? "md" : "txt"}`;
    a.click();
    URL.revokeObjectURL(url);
    onDownload?.(activeDoc);
  };

  const handleSaveAsPDF = () => {
    if (!activeDoc) return;
    // This would integrate with a PDF generation service
    // For now, just call the callback
    onSaveAsPDF?.(activeDoc);
  };

  const handleSaveAsDoc = () => {
    if (!activeDoc) return;
    // This would convert to .docx format
    // For now, just call the callback
    onSaveAsDoc?.(activeDoc);
  };

  const handleEmail = () => {
    if (!activeDoc) return;
    onEmail?.(activeDoc);
  };

  const handleToggleEdit = useCallback(() => {
    if (!activeDoc) return;
    if (editMode) {
      // Save changes
      if (editContent !== activeDoc.content) {
        saveCanvasDocument({ ...activeDoc, content: editContent }).catch((err) =>
          console.error("[Canvas] Save failed:", err),
        );
        // Update in-memory via pushToCanvas so parent state updates
        if (typeof window !== "undefined" && (window as any).pushToCanvas) {
          (window as any).pushToCanvas(
            activeDoc.title,
            editContent,
            activeDoc.type,
            activeDoc.language,
          );
        }
      }
      setEditMode(false);
    } else {
      setEditContent(activeDoc.content);
      setEditMode(true);
      // Focus textarea next tick
      setTimeout(() => editTextareaRef.current?.focus(), 50);
    }
  }, [activeDoc, editMode, editContent]);

  const handleCopy = useCallback(() => {
    if (!activeDoc) return;
    navigator.clipboard.writeText(activeDoc.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [activeDoc]);

  const handleCreateDocument = useCallback(
    (doc: {
      title: string;
      description: string;
      type: "markdown" | "code" | "data";
      language?: string;
      folder?: string;
    }) => {
      if (onCreateDocument) {
        onCreateDocument(doc);
      } else {
        // Fallback: push to canvas directly
        const content =
          doc.type === "markdown"
            ? `# ${doc.title}\n\n${doc.description || ""}`
            : doc.description || "";
        if (typeof window !== "undefined" && (window as any).pushToCanvas) {
          (window as any).pushToCanvas(doc.title, content, doc.type, doc.language);
        }
      }
      setNewDocOpen(false);
    },
    [onCreateDocument],
  );

  // Extract unique folders from documents for NewDocumentModal
  const existingFolders = useMemo(() => {
    const folders = new Set<string>();
    documents.forEach((doc) => {
      if (doc.title.includes("/")) {
        const parts = doc.title.split("/");
        if (parts.length > 1) folders.add(parts[0]);
      }
    });
    return [...folders].sort();
  }, [documents]);

  // Memoize the rendered content to prevent re-renders from parent state changes
  const renderedContent = useMemo(() => {
    if (!activeDoc) return null;

    return (
      <div className="max-w-4xl mx-auto">
        {activeDoc.type === "markdown" && (
          <div className="prose prose-invert prose-purple max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img({ src, alt }) {
                  const mediaSrc = toMediaUrl(src || "");
                  const fileName = (src || "image").split("/").pop() || "image.png";
                  return (
                    <span className="relative group inline-block my-2">
                      <DocMediaDownload mediaUrl={mediaSrc} fileName={fileName} />
                      <img
                        src={mediaSrc}
                        alt={alt || ""}
                        className="max-w-full rounded-lg border border-white/20"
                      />
                    </span>
                  );
                },
                // Handle video links in markdown: ![video](path.mp4)
                // ReactMarkdown treats all ![alt](src) as img — detect video/audio by extension
                p({ children, ...props }) {
                  // Check if children contain a string that looks like a media file path
                  const childArray = Array.isArray(children) ? children : [children];
                  const processed = childArray.map((child, i) => {
                    if (typeof child === "string") {
                      // Match bare file paths to media files
                      const pathMatch = child.match(
                        /(\/(?:var|tmp|Users)\/[^\s]+\.(?:mp4|webm|mov|mp3|wav|ogg|m4a|png|jpg|jpeg|gif|webp))/,
                      );
                      if (pathMatch) {
                        const filePath = pathMatch[1];
                        const ext = filePath.split(".").pop()?.toLowerCase() || "";
                        const mediaUrl = toMediaUrl(filePath);
                        const fileName = filePath.split("/").pop() || "media";

                        if (["mp4", "webm", "mov"].includes(ext)) {
                          return (
                            <span key={i} className="relative group block my-3">
                              <DocMediaDownload mediaUrl={mediaUrl} fileName={fileName} />
                              <video
                                controls
                                preload="metadata"
                                src={mediaUrl}
                                className="w-full max-w-2xl rounded-lg border border-white/20"
                              />
                            </span>
                          );
                        }
                        if (["mp3", "wav", "ogg", "m4a"].includes(ext)) {
                          return (
                            <span
                              key={i}
                              className="relative group block my-3 p-3 bg-white/5 rounded-lg"
                            >
                              <DocMediaDownload mediaUrl={mediaUrl} fileName={fileName} />
                              <audio
                                controls
                                preload="none"
                                src={mediaUrl}
                                className="w-full max-w-lg"
                              />
                            </span>
                          );
                        }
                      }
                    }
                    return child;
                  });
                  return <p {...props}>{processed}</p>;
                },
                code({ className, children, ...props }) {
                  // Detect inline code with media file paths
                  const codeStr = String(children).replace(/\n$/, "").trim();
                  if (
                    !className &&
                    (codeStr.startsWith("/var/") ||
                      codeStr.startsWith("/tmp/") ||
                      codeStr.startsWith("/Users/"))
                  ) {
                    const ext = codeStr.split(".").pop()?.toLowerCase() || "";
                    const mediaUrl = toMediaUrl(codeStr);
                    const fileName = codeStr.split("/").pop() || "media";

                    if (["mp4", "webm", "mov"].includes(ext)) {
                      return (
                        <span className="relative group block my-3">
                          <DocMediaDownload mediaUrl={mediaUrl} fileName={fileName} />
                          <video
                            controls
                            preload="metadata"
                            src={mediaUrl}
                            className="w-full max-w-2xl rounded-lg border border-white/20"
                          />
                        </span>
                      );
                    }
                    if (["mp3", "wav", "ogg", "m4a"].includes(ext)) {
                      return (
                        <span className="relative group block my-3 p-3 bg-white/5 rounded-lg">
                          <DocMediaDownload mediaUrl={mediaUrl} fileName={fileName} />
                          <audio
                            controls
                            preload="none"
                            src={mediaUrl}
                            className="w-full max-w-lg"
                          />
                        </span>
                      );
                    }
                    if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
                      return (
                        <span className="relative group inline-block my-2">
                          <DocMediaDownload mediaUrl={mediaUrl} fileName={fileName} />
                          <img
                            src={mediaUrl}
                            alt=""
                            className="max-w-full rounded-lg border border-white/20"
                          />
                        </span>
                      );
                    }
                  }
                  const match = /language-(\w+)/.exec(className || "");
                  const language = match ? match[1] : "";
                  const isInline = !className;

                  // Render Mermaid diagrams
                  if (!isInline && language === "mermaid") {
                    return <MermaidDiagram chart={String(children).replace(/\n$/, "")} />;
                  }

                  // Render code blocks with syntax highlighting
                  return !isInline && match ? (
                    <SyntaxHighlighter
                      style={vscDarkPlus as Record<string, React.CSSProperties>}
                      language={language}
                      PreTag="div"
                    >
                      {String(children).replace(/\n$/, "")}
                    </SyntaxHighlighter>
                  ) : (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
              }}
            >
              {activeDoc.content}
            </ReactMarkdown>
          </div>
        )}

        {activeDoc.type === "code" && (
          <SyntaxHighlighter
            style={vscDarkPlus}
            language={activeDoc.language || "typescript"}
            showLineNumbers
            customStyle={{
              margin: 0,
              borderRadius: "0.5rem",
              fontSize: "0.875rem",
            }}
          >
            {activeDoc.content}
          </SyntaxHighlighter>
        )}

        {activeDoc.type === "html" && (
          <div
            className="prose prose-invert prose-purple max-w-none"
            dangerouslySetInnerHTML={{
              __html: activeDoc.content.replace(
                /(<(?:img|video|audio|source)\s[^>]*src=["'])(?:MEDIA:\s*)?(\/(?:var|tmp|Users)\/[^"']+)(["'])/gi,
                (_m, pre, path, post) =>
                  `${pre}http://localhost:9242/api/media?path=${encodeURIComponent(path)}${post}`,
              ),
            }}
          />
        )}

        {activeDoc.type === "data" && (
          <pre className="bg-gray-800/50 p-4 rounded-lg text-white/80 text-sm overflow-x-auto">
            {activeDoc.content}
          </pre>
        )}
      </div>
    );
  }, [activeDoc?.id, activeDoc?.content, activeDoc?.type, activeDoc?.language]);

  if (!isOpen) return null;

  // Empty state when no documents
  if (documents.length === 0) {
    return (
      <div
        className="fixed bg-gray-900/95 border-l border-white/10 z-60 flex flex-col"
        style={{
          top: `${top}rem`,
          bottom: 0,
          left: `${left}vw`,
          width: `${width}vw`,
          transform: "translateZ(0)",
          backfaceVisibility: "hidden",
        }}
      >
        {/* Header controls are still shown in empty mode so docs/tools remain reachable */}
        <div className="border-b border-white/10 bg-gray-800/50 flex-shrink-0">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="px-2 py-1 rounded text-xs font-mono bg-white/10 text-white/60 border border-white/20">
                empty
              </span>
              <h2 className="text-white font-semibold text-lg">Canvas</h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setNewDocOpen(true)}
                className="p-2 rounded-lg bg-white/5 hover:bg-purple-500/20 text-white/70 hover:text-purple-300 transition-all group relative"
                title="New Document"
              >
                <Plus className="w-5 h-5" />
                <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                  New
                </span>
              </button>

              {gateway && (
                <button
                  onClick={onNewTerminal}
                  className="p-2 rounded-lg bg-white/5 hover:bg-green-500/20 text-white/70 hover:text-green-300 transition-all group relative"
                  title="New Terminal"
                >
                  <TerminalSquare className="w-5 h-5" />
                  <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    Terminal
                  </span>
                </button>
              )}

              <button
                onClick={() => setBrowserOpen(true)}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all group relative"
                title="Browse Documents"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                  Documents
                </span>
              </button>

              <button
                onClick={onClose}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all"
                title="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="h-full flex flex-col items-center justify-center p-8">
          <div className="text-center">
            <div className="text-6xl mb-4">📄</div>
            <h2 className="text-white text-2xl font-semibold mb-2">Canvas is Empty</h2>
            <p className="text-white/50 mb-6 max-w-md">
              Ask me to create a document, write code, or generate content and it will appear here.
            </p>
            <button
              onClick={() => setBrowserOpen(true)}
              className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all"
            >
              Open Documents
            </button>
          </div>
        </div>

        <CanvasDocumentBrowser
          isOpen={browserOpen}
          onClose={() => setBrowserOpen(false)}
          onLoadDocument={(doc) => {
            if (typeof window !== "undefined" && (window as any).pushToCanvas) {
              (window as any).pushToCanvas(doc.title, doc.content, doc.type, doc.language);
            }
          }}
          onNewDocument={() => {
            setBrowserOpen(false);
            setNewDocOpen(true);
          }}
        />

        <NewDocumentModal
          isOpen={newDocOpen}
          onClose={() => setNewDocOpen(false)}
          onCreate={handleCreateDocument}
          existingFolders={existingFolders}
        />
      </div>
    );
  }

  return (
    <div
      className="fixed bg-gray-900/95 border-l border-white/10 z-60 flex flex-col"
      style={{
        top: `${top}rem`,
        bottom: 0,
        left: `${left}vw`,
        width: `${width}vw`,
        transform: "translateZ(0)", // Force GPU acceleration for smoother rendering
        backfaceVisibility: "hidden", // Prevent flicker
      }}
    >
      {/* Header with Controls */}
      <div className="border-b border-white/10 bg-gray-800/50 flex-shrink-0">
        {/* Document Tabs (if multiple) */}
        {documents.length > 1 && (
          <div className="flex gap-1 px-4 pt-3 overflow-x-auto">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`group/tab flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm transition-all whitespace-nowrap cursor-pointer ${
                  doc.id === activeDoc?.id
                    ? "bg-gray-700/80 text-white border-b-2 border-purple-500"
                    : "bg-gray-800/50 text-white/60 hover:text-white/80 hover:bg-gray-700/50"
                }`}
                onClick={() => onDocumentChange?.(doc.id)}
              >
                <span className="truncate max-w-[150px]">{doc.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab?.(doc.id);
                  }}
                  className={`p-0.5 rounded hover:bg-white/10 hover:text-white transition-all ml-0.5 flex-shrink-0 ${
                    doc.id === activeDoc?.id
                      ? "text-white/40"
                      : "text-white/20 opacity-0 group-hover/tab:opacity-100"
                  }`}
                  title="Close tab"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Also show delete for single doc */}
        {documents.length === 1 && (
          <div className="flex gap-1 px-4 pt-3">
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm bg-gray-700/80 text-white border-b-2 border-purple-500">
              <span className="truncate max-w-[150px]">{documents[0].title}</span>
              <button
                onClick={() => onCloseTab?.(documents[0].id)}
                className="p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white transition-all ml-0.5 flex-shrink-0"
                title="Close tab"
              >
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Control Bar */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Document type badge */}
            <span className="px-2 py-1 rounded text-xs font-mono bg-purple-600/20 text-purple-300 border border-purple-500/30">
              {activeDoc?.type}
            </span>
            <h2 className="text-white font-semibold text-lg">{activeDoc?.title}</h2>
            {activeDoc?.type === "terminal" && activeDoc.terminalId && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigator.clipboard
                    .writeText(activeDoc.terminalId!)
                    .then(() => {
                      setCopiedTerminalId(true);
                      setTimeout(() => setCopiedTerminalId(false), 1200);
                    })
                    .catch(() => {
                      setCopiedTerminalId(false);
                    });
                }}
                className="px-2 py-0.5 rounded text-xs font-mono bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10 transition-all cursor-pointer"
                title="Click to copy terminal ID"
              >
                {copiedTerminalId ? "Copied!" : activeDoc.terminalId}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* New Document Button */}
            <button
              onClick={() => setNewDocOpen(true)}
              className="p-2 rounded-lg bg-white/5 hover:bg-purple-500/20 text-white/70 hover:text-purple-300 transition-all group relative"
              title="New Document"
            >
              <Plus className="w-5 h-5" />
              <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                New
              </span>
            </button>

            {/* New Terminal Button */}
            {gateway && (
              <button
                onClick={onNewTerminal}
                className="p-2 rounded-lg bg-white/5 hover:bg-green-500/20 text-white/70 hover:text-green-300 transition-all group relative"
                title="New Terminal"
              >
                <TerminalSquare className="w-5 h-5" />
                <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                  Terminal
                </span>
              </button>
            )}

            {/* Documents Browser Button */}
            <button
              onClick={() => setBrowserOpen(true)}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all group relative"
              title="Browse Documents"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                Documents
              </span>
            </button>

            {/* Edit/Preview Toggle (hide for terminals) */}
            {activeDoc?.type !== "terminal" && (
              <button
                onClick={handleToggleEdit}
                className={`p-2 rounded-lg transition-all group relative ${
                  editMode
                    ? "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30"
                    : "bg-white/5 hover:bg-white/10 text-white/70 hover:text-white"
                }`}
                title={editMode ? "Save & Preview" : "Edit"}
              >
                {editMode ? <Eye className="w-5 h-5" /> : <Pencil className="w-5 h-5" />}
                <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                  {editMode ? "Preview" : "Edit"}
                </span>
              </button>
            )}

            {activeDoc?.type !== "terminal" && activeDoc?.type !== "debate" && (
              <div className="w-px h-6 bg-white/10 mx-1" />
            )}

            {/* Copy Button (hide for terminals and debates) */}
            {activeDoc?.type !== "terminal" && activeDoc?.type !== "debate" && (
              <button
                onClick={handleCopy}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all group relative"
                title={copied ? "Copied!" : "Copy to Clipboard"}
              >
                {copied ? (
                  <Check className="w-5 h-5 text-green-400" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
                <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                  {copied ? "Copied!" : "Copy"}
                </span>
              </button>
            )}

            {/* Action Buttons (hide for terminals and debates) */}
            {activeDoc?.type !== "terminal" && activeDoc?.type !== "debate" && (
              <>
                <button
                  onClick={handleDownload}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all group relative"
                  title="Download"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    Download
                  </span>
                </button>

                <button
                  onClick={handleSaveAsPDF}
                  className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all text-sm group relative"
                  title="Save as PDF"
                >
                  PDF
                  <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    Save as PDF
                  </span>
                </button>

                <button
                  onClick={handleSaveAsDoc}
                  className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all text-sm group relative"
                  title="Save as Doc"
                >
                  DOC
                  <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    Save as Word Doc
                  </span>
                </button>

                <button
                  onClick={handleEmail}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all group relative"
                  title="Email"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    Email
                  </span>
                </button>

                <div className="w-px h-6 bg-white/10 mx-1" />
              </>
            )}

            {/* Delete Button */}
            <button
              onClick={() => activeDoc && setDeleteConfirmDocId(activeDoc.id)}
              className="p-2 rounded-lg bg-white/5 hover:bg-red-500/20 text-white/50 hover:text-red-400 transition-all group relative"
              title="Delete document"
            >
              <Trash2 className="w-5 h-5" />
              <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                Delete
              </span>
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all"
              title="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Document Content */}
      {activeDoc?.type === "debate" && debateState ? (
        <div className="flex-1 min-h-0">
          <DebatePanel state={debateState} />
        </div>
      ) : activeDoc?.type === "terminal" && activeDoc.terminalId && gateway ? (
        <div className="flex-1 min-h-0 relative">
          <TerminalView
            terminalId={activeDoc.terminalId}
            gateway={gateway}
            isActive={activeDoc.id === activeDocId}
          />
        </div>
      ) : (
        <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto p-6">
          {editMode && activeDoc ? (
            <textarea
              ref={editTextareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-full min-h-[400px] bg-gray-800/50 border border-white/10 rounded-lg p-4 text-white text-sm font-mono resize-none focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30"
              spellCheck={false}
            />
          ) : (
            renderedContent
          )}
        </div>
      )}

      {/* Document Browser Modal */}
      <CanvasDocumentBrowser
        isOpen={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onLoadDocument={(doc) => {
          // Push loaded document to canvas using global API
          if (typeof window !== "undefined" && (window as any).pushToCanvas) {
            (window as any).pushToCanvas(doc.title, doc.content, doc.type, doc.language);
          }
        }}
        onNewDocument={() => {
          setBrowserOpen(false);
          setNewDocOpen(true);
        }}
      />

      {/* New Document Modal */}
      <NewDocumentModal
        isOpen={newDocOpen}
        onClose={() => setNewDocOpen(false)}
        onCreate={handleCreateDocument}
        existingFolders={existingFolders}
      />

      {/* Delete Confirmation Dialog */}
      {deleteConfirmDocId &&
        (() => {
          const docToDelete = documents.find((d) => d.id === deleteConfirmDocId);
          if (!docToDelete) return null;
          return (
            <DeleteConfirmDialog
              docTitle={docToDelete.title}
              onDeleteDoc={() => {
                onDeleteDocument?.(deleteConfirmDocId, false);
                setDeleteConfirmDocId(null);
              }}
              onDeleteAll={() => {
                onDeleteDocument?.(deleteConfirmDocId, true);
                setDeleteConfirmDocId(null);
              }}
              onCancel={() => setDeleteConfirmDocId(null)}
            />
          );
        })()}
    </div>
  );
}

// Global API for pushing content to canvas
export function pushToCanvas(
  title: string,
  content: string,
  type: CanvasDocument["type"] = "markdown",
  language?: string,
  terminalId?: string,
  documentId?: string,
  createdAt?: string | number | Date,
) {
  const event = new CustomEvent("canvas:push", {
    detail: {
      id: documentId || Date.now().toString(),
      title,
      content,
      type,
      language,
      terminalId,
      createdAt: createdAt ? new Date(createdAt) : new Date(),
    } as CanvasDocument,
  });
  window.dispatchEvent(event);
}

// Make it globally accessible
if (typeof window !== "undefined") {
  (window as any).pushToCanvas = pushToCanvas;
}
