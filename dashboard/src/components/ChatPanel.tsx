import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  // Image as ImageIcon,
  X,
  Play,
  Square,
  Copy,
  Check,
  Menu,
  Plus,
  Download,
  Maximize2,
  Pause,
  ChevronDown,
  ChevronRight,
  ThumbsUp,
  ThumbsDown,
  FileText,
  PanelRightClose,
  Minimize2,
  FolderOpen,
  TerminalSquare,
  Paperclip,
  Database,
  CircleHelp,
  Eye,
  EyeOff,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import { getMoodColor, getMoodIcon, type MoodName } from "../lib/moodSystem";
import { AudioDeviceSelector, type Voice } from "./AudioDeviceSelector";

// Code block with copy button for markdown rendering
function CodeBlock({ language, children }: { language?: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-2 rounded-lg overflow-hidden">
      {language && (
        <div className="flex items-center justify-between px-3 py-1 bg-white/5 text-white/40 text-xs">
          <span>{language}</span>
        </div>
      )}
      <button
        onClick={handleCopy}
        className="absolute top-1 right-1 p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white/50 hover:text-white/80 opacity-0 group-hover:opacity-100 transition-all z-10"
        title="Copy code"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-green-400" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: "0.75rem",
          fontSize: "0.8rem",
          background: "rgba(255,255,255,0.03)",
          borderRadius: language ? "0 0 0.5rem 0.5rem" : "0.5rem",
        }}
        wrapLongLines
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

// Download button overlay for media elements — fetches blob to force real download prompt
function MediaDownloadButton({ mediaUrl, fileName }: { mediaUrl: string; fileName: string }) {
  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(mediaUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("[Download] Failed:", err);
    }
  };

  return (
    <button
      onClick={handleDownload}
      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-all z-10 backdrop-blur-sm"
      title="Save to Disk"
    >
      <Download className="w-4 h-4" />
    </button>
  );
}

// Full-screen media lightbox modal (images and videos)
function MediaLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const isVideo = /\.(mp4|webm|mov)/i.test(src) || /\bvideo\b/i.test(src);
  const fileName = (src.split("/").pop() || "media").replace(/\?.*/, "");
  const handleDownload = async () => {
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("[Lightbox] Download failed:", err);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      >
        {isVideo ? (
          <motion.video
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            src={src}
            controls
            autoPlay
            className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <motion.img
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            src={src}
            alt="Image"
            className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {/* Top-right controls */}
        <div className="absolute top-4 right-4 flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDownload();
            }}
            className="p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white/70 hover:text-white transition-all backdrop-blur-sm"
            title="Download"
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white/70 hover:text-white transition-all backdrop-blur-sm"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// Resolve a file path to a media API URL
function toMediaUrl(filePath: string): string {
  return `http://localhost:9242/api/media?path=${encodeURIComponent(filePath)}`;
}

// Detect media file extensions
function getMediaType(path: string): "image" | "video" | "audio" | null {
  if (/\.(png|jpg|jpeg|gif|webp)$/i.test(path)) return "image";
  if (/\.(mp4|webm|mov)$/i.test(path)) return "video";
  if (/\.(mp3|wav|ogg|m4a)$/i.test(path)) return "audio";
  return null;
}

// Render inline media from a file path
function InlineMedia({
  filePath,
  onImageClick,
}: {
  filePath: string;
  onImageClick?: (src: string) => void;
}) {
  const mediaUrl = toMediaUrl(filePath);
  const fileName = filePath.split("/").pop() || "download";
  const type = getMediaType(filePath);

  if (type === "video") {
    return (
      <div className="relative group my-2">
        <MediaDownloadButton mediaUrl={mediaUrl} fileName={fileName} />
        <button
          onClick={() => onImageClick?.(mediaUrl)}
          className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-all z-10 backdrop-blur-sm"
          title="Expand"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <video
          controls
          preload="metadata"
          src={mediaUrl}
          className="max-w-full rounded-lg border border-white/20"
          onError={(e) => console.error("[Video] Failed to load:", mediaUrl, e)}
        />
      </div>
    );
  }

  if (type === "image") {
    return (
      <div className="relative group my-2 inline-block">
        <MediaDownloadButton mediaUrl={mediaUrl} fileName={fileName} />
        <img
          src={mediaUrl}
          alt="Generated"
          className="max-w-full rounded-lg border border-white/20 cursor-pointer hover:brightness-110 transition-all"
          onClick={() => onImageClick?.(mediaUrl)}
        />
      </div>
    );
  }

  if (type === "audio") {
    return (
      <div className="relative group my-2 flex items-center gap-2 p-2 bg-white/5 rounded-lg">
        <MediaDownloadButton mediaUrl={mediaUrl} fileName={fileName} />
        <Play className="w-4 h-4 text-purple-400 flex-shrink-0" />
        <DeferredAudio
          src={mediaUrl}
          className="h-8 flex-1 max-w-[250px]"
          onError={(e) => console.error("[Audio] Failed to load:", mediaUrl, e)}
        />
      </div>
    );
  }

  return null;
}

function DeferredAudio({
  src,
  className,
  onError,
}: {
  src: string;
  className?: string;
  onError?: (e: React.SyntheticEvent<HTMLAudioElement, Event>) => void;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className={`text-xs text-red-400/70 italic ${className ?? ""}`}>Audio unavailable</span>
    );
  }

  return (
    <audio
      controls
      preload="metadata"
      src={src}
      className={className}
      onError={(e) => {
        setFailed(true);
        onError?.(e);
      }}
    />
  );
}

// Detect absolute file/folder paths
const PATH_REGEX =
  /^\/(?:Users|home|tmp|var|opt|etc|usr|Volumes|Library|System|private|Applications)[\/][^\s]*/;

function isFilePath(text: string): boolean {
  return PATH_REGEX.test(text.trim());
}

// Clickable path with Finder/Terminal actions
function PathLink({ path: filePath }: { path: string }) {
  const [showMenu, setShowMenu] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const menuRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  const openPath = async (mode: "finder" | "terminal") => {
    setShowMenu(false);
    try {
      const res = await fetch("/api/system/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, mode }),
      });
      setStatus(res.ok ? "ok" : "error");
    } catch {
      setStatus("error");
    }
    setTimeout(() => setStatus("idle"), 1500);
  };

  return (
    <span ref={menuRef} className="relative inline-flex items-center group/path">
      <code
        className="px-1.5 py-0.5 rounded bg-white/10 text-purple-300 text-xs font-mono cursor-pointer hover:bg-purple-500/20 hover:text-purple-200 transition-colors"
        onClick={() => setShowMenu((v) => !v)}
        title="Click for actions"
      >
        {filePath}
      </code>
      {status === "ok" && <Check className="w-3 h-3 text-green-400 ml-1 flex-shrink-0" />}
      {showMenu && (
        <span className="absolute top-full left-0 mt-1 z-50 bg-gray-800 border border-white/20 rounded-lg shadow-xl overflow-hidden min-w-[160px]">
          <button
            onClick={() => openPath("finder")}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-white/80 hover:bg-purple-500/20 hover:text-white transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Open in Finder
          </button>
          <button
            onClick={() => openPath("terminal")}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-white/80 hover:bg-green-500/20 hover:text-white transition-colors"
          >
            <TerminalSquare className="w-3.5 h-3.5" />
            Open Terminal Here
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(filePath);
              setShowMenu(false);
              setStatus("ok");
              setTimeout(() => setStatus("idle"), 1500);
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy Path
          </button>
        </span>
      )}
    </span>
  );
}

// Helper to render message content with MEDIA support + markdown
function MessageContent({
  content,
  role,
  onImageClick,
}: {
  content: string;
  role: string;
  onImageClick?: (src: string) => void;
}) {
  const mediaMarkers = content.match(/MEDIA:([^\s\n]+)/gi) || [];
  const mediaPaths = mediaMarkers.map((m) => m.replace(/^MEDIA:/i, "").trim()).filter(Boolean);
  const contentWithoutMedia = content.replace(/MEDIA:[^\s\n]+/gi, "").trim();

  const renderMedia = (filePath: string, idx: number) => {
    const media = <InlineMedia filePath={filePath} onImageClick={onImageClick} />;
    if (media) return <div key={`${filePath}-${idx}`}>{media}</div>;

    const mediaUrl = toMediaUrl(filePath);
    const fileName = filePath.split("/").pop() || "download";
    return (
      <a
        key={`${filePath}-${idx}`}
        href={mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-purple-400 underline text-sm"
      >
        {fileName}
      </a>
    );
  };

  if (mediaPaths.length > 0 && !contentWithoutMedia) {
    return <div className="space-y-2">{mediaPaths.map(renderMedia)}</div>;
  }

  // User messages: plain text with URL detection (no markdown)
  if (role === "user") {
    const parts = contentWithoutMedia.split(/(https?:\/\/[^\s<>)"']+)/g);

    if (parts.length === 1) {
      return (
        <div className="space-y-2">
          <p className="text-sm whitespace-pre-wrap">{contentWithoutMedia}</p>
          {mediaPaths.length > 0 && <div className="space-y-2">{mediaPaths.map(renderMedia)}</div>}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <p className="text-sm whitespace-pre-wrap">
          {parts.map((part, i) =>
            /^https?:\/\//.test(part) ? (
              <a
                key={i}
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline break-all"
              >
                {part}
              </a>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </p>
        {mediaPaths.length > 0 && <div className="space-y-2">{mediaPaths.map(renderMedia)}</div>}
      </div>
    );
  }

  // Assistant messages: render as GitHub-flavored markdown with syntax highlighting
  return (
    <div className="space-y-2">
      <div className="text-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || "");
              const codeStr = String(children).replace(/\n$/, "");
              // Multi-line code or code with language = fenced code block
              if (match || codeStr.includes("\n")) {
                return <CodeBlock language={match?.[1]}>{codeStr}</CodeBlock>;
              }
              // Detect inline code that is a media file path
              const trimmed = codeStr.trim();
              if (
                (trimmed.startsWith("/var/") ||
                  trimmed.startsWith("/tmp/") ||
                  trimmed.startsWith("/Users/")) &&
                getMediaType(trimmed)
              ) {
                return <InlineMedia filePath={trimmed} onImageClick={onImageClick} />;
              }
              // Detect inline code that is a file/folder path → clickable PathLink
              if (isFilePath(trimmed)) {
                return <PathLink path={trimmed} />;
              }
              // Inline code
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-white/10 text-purple-300 text-xs font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            },
            // Detect images/videos in markdown and render appropriate element
            img({ src, alt }) {
              let mediaSrc = src || "";
              if (mediaSrc.startsWith("file://")) mediaSrc = mediaSrc.replace("file://", "");
              if (
                mediaSrc.startsWith("/var/") ||
                mediaSrc.startsWith("/tmp/") ||
                mediaSrc.startsWith("/Users/")
              ) {
                mediaSrc = toMediaUrl(mediaSrc);
              }
              const fileName = (src || "image").split("/").pop() || "image.png";
              const mediaType = getMediaType(src || "");
              if (mediaType === "video") {
                return (
                  <div className="relative group my-2">
                    <MediaDownloadButton mediaUrl={mediaSrc} fileName={fileName} />
                    <video
                      controls
                      preload="metadata"
                      src={mediaSrc}
                      className="max-w-full rounded-lg border border-white/20"
                    />
                  </div>
                );
              }
              return (
                <span className="relative group inline-block my-2">
                  <MediaDownloadButton mediaUrl={mediaSrc} fileName={fileName} />
                  <img
                    src={mediaSrc}
                    alt={alt || "Media"}
                    className="max-w-full rounded-lg border border-white/20 cursor-pointer hover:brightness-110 transition-all"
                    onClick={() => onImageClick?.(mediaSrc)}
                  />
                </span>
              );
            },
            a({ href, children }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300 underline break-all"
                >
                  {children}
                </a>
              );
            },
            p({ children }) {
              return <div className="mb-2 last:mb-0 whitespace-pre-wrap">{children}</div>;
            },
            ul({ children }) {
              return <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>;
            },
            ol({ children }) {
              return <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>;
            },
            li({ children }) {
              return <li className="text-white/90">{children}</li>;
            },
            h1({ children }) {
              return <h1 className="text-lg font-bold text-white mb-2 mt-3">{children}</h1>;
            },
            h2({ children }) {
              return <h2 className="text-base font-bold text-white mb-1.5 mt-2">{children}</h2>;
            },
            h3({ children }) {
              return <h3 className="text-sm font-bold text-white mb-1 mt-2">{children}</h3>;
            },
            blockquote({ children }) {
              return (
                <blockquote className="border-l-2 border-purple-400/50 pl-3 my-2 text-white/60 italic">
                  {children}
                </blockquote>
              );
            },
            table({ children }) {
              return (
                <div className="overflow-x-auto my-2">
                  <table className="min-w-full text-xs border-collapse border border-white/10">
                    {children}
                  </table>
                </div>
              );
            },
            th({ children }) {
              return (
                <th className="px-2 py-1 bg-white/10 border border-white/10 text-left font-semibold text-white/80">
                  {children}
                </th>
              );
            },
            td({ children }) {
              return <td className="px-2 py-1 border border-white/10 text-white/70">{children}</td>;
            },
            hr() {
              return <hr className="border-white/10 my-3" />;
            },
            strong({ children }) {
              return <strong className="font-bold text-white">{children}</strong>;
            },
            em({ children }) {
              return <em className="italic text-white/80">{children}</em>;
            },
          }}
        >
          {contentWithoutMedia}
        </ReactMarkdown>
      </div>
      {mediaPaths.length > 0 && <div className="space-y-2">{mediaPaths.map(renderMedia)}</div>}
    </div>
  );
}

export interface ModelInfo {
  provider: string;
  model: string;
  tier: string;
  score: number;
  routed: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  image?: string; // Base64 or URL
  modelInfo?: ModelInfo;
  toolsUsed?: string[];
  mood?: string; // AI mood for this response
  familySource?: string; // Family member who triggered this (e.g. "forge", "scout")
  ttsSummary?: string; // The text that was spoken via TTS
  ttsAudioUrl?: string; // Blob URL of the spoken audio for replay
  feedback?: "up" | "down" | null; // Human feedback on this response
}

export type TtsDisplayMode = "text-voice" | "voice-first" | "voice-only";

export interface ChatAttachment {
  type: string;
  mimeType: string;
  fileName: string;
  content: string; // image/binary: base64 (no data URL prefix), text docs: plain UTF-8 text
}

const TEXT_ATTACHMENT_TYPES = [
  "text/",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/yaml",
  "application/csv",
  "application/x-sh",
];

const TEXT_ATTACHMENT_EXTENSIONS = [
  ".md",
  ".txt",
  ".csv",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".log",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".scss",
  ".html",
  ".htm",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".toml",
  ".ini",
  ".cfg",
  ".env",
  ".gitignore",
  ".dockerfile",
  ".prisma",
  ".graphql",
  ".svg",
];

function isTextAttachmentFile(file: File): boolean {
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  return (
    TEXT_ATTACHMENT_TYPES.some((t) => file.type.startsWith(t)) ||
    TEXT_ATTACHMENT_EXTENSIONS.includes(ext)
  );
}

type IngestPreset = {
  value: number;
  label: string;
  reason: string;
};

const INGEST_CHUNK_SIZE_PRESETS: IngestPreset[] = [
  {
    value: 1800,
    label: "Suggested (1800)",
    reason: "Balanced recall, citation precision, and embedding cost for most docs.",
  },
  {
    value: 1200,
    label: "Small Chunks (1200)",
    reason: "Better for dense technical docs where exact passage matching matters.",
  },
  {
    value: 2400,
    label: "Large Chunks (2400)",
    reason: "Good for narrative docs where wider context helps retrieval.",
  },
  {
    value: 3200,
    label: "Very Large (3200)",
    reason: "Use for long-form material when you want fewer, broader chunks.",
  },
];

const INGEST_OVERLAP_PRESETS: IngestPreset[] = [
  {
    value: 200,
    label: "Suggested (200)",
    reason: "Keeps continuity between chunks without excessive duplication.",
  },
  {
    value: 100,
    label: "Light (100)",
    reason: "Lower storage/cost footprint with less repeated content.",
  },
  {
    value: 300,
    label: "Deep Context (300)",
    reason: "Useful when key facts span chunk boundaries.",
  },
  {
    value: 400,
    label: "Max Continuity (400)",
    reason: "Most resilient boundary handling, but increases duplicate context.",
  },
];

/** Collapsible TTS summary with inline audio player */
function TTSSummary({ summary, audioUrl }: { summary: string; audioUrl?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] text-purple-300/80 hover:text-purple-300 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Volume2 className="w-3 h-3" />
        <span className="font-medium">Spoken Summary</span>
      </button>
      {expanded && (
        <div className="mt-1.5 pl-1">
          <p className="text-[12px] text-white/60 leading-relaxed whitespace-pre-wrap">{summary}</p>
          {audioUrl && (
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={togglePlay}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-[10px] transition-colors"
              >
                {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                {playing ? "Pause" : "Replay"}
              </button>
              <a
                href={audioUrl}
                download={`argent-speech-${Date.now()}.mp3`}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-[10px] transition-colors"
              >
                <Download className="w-3 h-3" />
                Download
              </a>
              <audio
                ref={audioRef}
                src={audioUrl}
                preload="none"
                onEnded={() => setPlaying(false)}
                onPause={() => setPlaying(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SlashCommand {
  key: string;
  description: string;
  aliases: string[];
  category: string;
  acceptsArgs: boolean;
}

type BusyMessageMode = "cue" | "steer";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (message: string, image?: string, attachments?: ChatAttachment[]) => void;
  onCommand?: (command: string, args?: string) => void;
  commands?: SlashCommand[];
  isLoading?: boolean;
  activeTool?: string | null;
  activeModelInfo?: {
    provider: string;
    model: string;
    tier: string;
    score: number;
    routed: boolean;
  } | null;
  audioEnabled?: boolean;
  onToggleAudio?: () => void;
  ttsDisplayMode?: TtsDisplayMode;
  onCycleTtsDisplayMode?: () => void;
  micEnabled?: boolean;
  onToggleMic?: () => void;
  isListening?: boolean;
  isProcessingSpeech?: boolean;
  speechError?: string | null;
  deepThinkMode?: boolean;
  onToggleDeepThink?: () => void;
  deepResearchMode?: boolean;
  onToggleDeepResearch?: () => void;
  canvasOpen?: boolean;
  onToggleCanvas?: () => void;
  // Audio device props
  selectedInput?: string;
  selectedOutput?: string;
  selectedVoice?: Voice;
  activeVoiceLabel?: string;
  voiceSelectionLocked?: boolean;
  onInputChange?: (deviceId: string) => void;
  onOutputChange?: (deviceId: string) => void;
  onVoiceChange?: (voice: Voice) => void;
  // TTS interrupt
  isSpeaking?: boolean;
  onStopTTS?: () => void;
  // Agent interrupt
  onInterrupt?: (message: string) => void;
  onSteer?: (message: string, image?: string, attachments?: ChatAttachment[]) => void;
  busyMode?: BusyMessageMode;
  onBusyModeChange?: (mode: BusyMessageMode) => void;
  // Message queue
  onQueue?: (message: string, image?: string, attachments?: ChatAttachment[]) => void;
  queuedMessages?: Array<{ content: string; image?: string }>;
  onDequeue?: (index: number) => void;
  // Session management
  onToggleSessions?: () => void;
  onNewChat?: () => void;
  chatAgentId?: string;
  chatAgentOptions?: Array<{ id: string; label: string }>;
  onChangeChatAgent?: (agentId: string) => void;
  sessionTitle?: string;
  // Accountability feedback
  onFeedback?: (messageId: string, type: "up" | "down") => void;
  // Doc panel focus context
  focusDoc?: { id: string; title: string } | null;
  onClearFocus?: () => void;
  // Collapse
  onToggleCollapse?: () => void;
  // Context usage
  contextUsage?: { used: number; total: number; estimated?: boolean };
  // Gateway RPC helper (preferred for knowledge ingest so writes follow core storage path)
  gatewayRequest?: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
  currentSessionKey?: string;
}

export function ChatPanel({
  messages,
  onSend,
  onCommand,
  commands = [],
  isLoading = false,
  activeTool = null,
  activeModelInfo = null,
  audioEnabled = false,
  onToggleAudio,
  ttsDisplayMode = "text-voice",
  onCycleTtsDisplayMode,
  micEnabled = false,
  onToggleMic,
  isListening = false,
  isProcessingSpeech = false,
  speechError = null,
  deepThinkMode = false,
  onToggleDeepThink,
  deepResearchMode = false,
  onToggleDeepResearch,
  canvasOpen = false,
  onToggleCanvas,
  selectedInput,
  selectedOutput,
  selectedVoice,
  activeVoiceLabel,
  voiceSelectionLocked = false,
  onInputChange,
  onOutputChange,
  onVoiceChange,
  isSpeaking = false,
  onStopTTS,
  onInterrupt,
  onSteer,
  busyMode = "cue",
  onBusyModeChange,
  onQueue,
  queuedMessages = [],
  onDequeue,
  onToggleSessions,
  onNewChat,
  chatAgentId,
  chatAgentOptions = [],
  onChangeChatAgent,
  sessionTitle,
  onFeedback,
  focusDoc = null,
  onClearFocus,
  onToggleCollapse,
  contextUsage,
  gatewayRequest,
  currentSessionKey,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [compactThinking, setCompactThinking] = useState(
    () => localStorage.getItem("argent-compact-thinking") !== "false",
  );
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [cmdSelectedIdx, setCmdSelectedIdx] = useState(0);
  const [showIngestModal, setShowIngestModal] = useState(false);
  const [ingestFiles, setIngestFiles] = useState<ChatAttachment[]>([]);
  const [ingestCollection, setIngestCollection] = useState("default");
  const [ingestCollections, setIngestCollections] = useState<string[]>(["default"]);
  const [ingestCollectionsLoading, setIngestCollectionsLoading] = useState(false);
  const [creatingIngestCollection, setCreatingIngestCollection] = useState(false);
  const [newIngestCollection, setNewIngestCollection] = useState("");
  const [ingestChunkSize, setIngestChunkSize] = useState(1800);
  const [ingestChunkOverlap, setIngestChunkOverlap] = useState(200);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestMessage, setIngestMessage] = useState<string | null>(null);
  const [showIngestHelp, setShowIngestHelp] = useState(false);
  const [routingTelemetry, setRoutingTelemetry] = useState<{
    counters?: Record<string, number>;
    updatedAt?: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ingestFileInputRef = useRef<HTMLInputElement>(null);
  const cmdDropdownRef = useRef<HTMLDivElement>(null);
  const inputIdPrefix = useId().replace(/:/g, "");
  const attachmentInputId = `${inputIdPrefix}-chat-attachment-input`;
  const ingestInputId = `${inputIdPrefix}-chat-ingest-input`;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!gatewayRequest) return;
    let cancelled = false;
    const loadRouting = async () => {
      try {
        const payload = await gatewayRequest<{
          telemetry?: {
            counters?: Record<string, number>;
            updatedAt?: string;
          };
        }>("family.telemetry");
        if (!cancelled) {
          setRoutingTelemetry(payload?.telemetry ?? null);
        }
      } catch {
        // Keep chat responsive even if telemetry endpoint is unavailable.
      }
    };

    void loadRouting();
    const timer = setInterval(() => {
      void loadRouting();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [gatewayRequest]);

  // Command autocomplete filtering
  const filteredCommands = (() => {
    if (!input.startsWith("/") || commands.length === 0) return [];
    const typed = input.toLowerCase();
    // Don't show dropdown if input has a space (user is typing args)
    if (typed.includes(" ")) return [];
    return commands.filter((cmd) =>
      cmd.aliases.some((alias) => alias.toLowerCase().startsWith(typed)),
    );
  })();
  const showCmdDropdown = filteredCommands.length > 0;

  // Reset selection when filtered list changes
  useEffect(() => {
    setCmdSelectedIdx(0);
  }, [filteredCommands.length]);

  const selectCommand = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.acceptsArgs) {
        // Fill command name and let user type args
        const alias = cmd.aliases[0] || `/${cmd.key}`;
        setInput(alias + " ");
        inputRef.current?.focus();
      } else if (onCommand) {
        // No args needed — execute immediately
        onCommand(cmd.key);
        setInput("");
        if (inputRef.current) inputRef.current.style.height = "auto";
      } else {
        // Fallback: send as text
        const alias = cmd.aliases[0] || `/${cmd.key}`;
        onSend(alias);
        setInput("");
        if (inputRef.current) inputRef.current.style.height = "auto";
      }
    },
    [onCommand, onSend],
  );

  const handleFileSelect = (file: File) => {
    setAttachmentError(null);
    // Images go to the image preview (existing behavior)
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onerror = () => {
        setAttachmentError(`Failed to read image attachment: ${file.name}`);
      };
      reader.onload = (e) => {
        setAttachedImage(e.target?.result as string);
      };
      reader.readAsDataURL(file);
      return;
    }

    // Text-readable file types — read as text for the agent to process directly
    const isText = isTextAttachmentFile(file);

    if (isText) {
      const reader = new FileReader();
      reader.onerror = () => {
        setAttachmentError(`Failed to read attachment: ${file.name}`);
      };
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setAttachedFiles((prev) => [
          ...prev,
          {
            type: "document",
            mimeType: file.type || "text/plain",
            fileName: file.name,
            content,
          },
        ]);
      };
      reader.readAsText(file);
    } else {
      // Binary files (docx, xlsx, pdf, etc.) — read as base64
      const reader = new FileReader();
      reader.onerror = () => {
        setAttachmentError(`Failed to read attachment: ${file.name}`);
      };
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const base64 = dataUrl.split(",")[1] || "";
        setAttachedFiles((prev) => [
          ...prev,
          {
            type: "document",
            mimeType: file.type || "application/octet-stream",
            fileName: file.name,
            content: base64,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleIngestFileSelect = (file: File) => {
    const isText = isTextAttachmentFile(file);
    if (isText) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setIngestFiles((prev) => [
          ...prev,
          {
            type: "document",
            mimeType: file.type || "text/plain",
            fileName: file.name,
            content,
          },
        ]);
      };
      reader.readAsText(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const base64 = dataUrl.split(",")[1] || "";
      setIngestFiles((prev) => [
        ...prev,
        {
          type: "document",
          mimeType: file.type || "application/octet-stream",
          fileName: file.name,
          content: base64,
        },
      ]);
    };
    reader.readAsDataURL(file);
  };

  const handleKnowledgeIngest = async () => {
    if (ingestFiles.length === 0 || isIngesting) return;
    if (!gatewayRequest) {
      setIngestMessage("Ingest unavailable: gateway request bridge is not connected.");
      return;
    }
    const resolvedCollection = creatingIngestCollection
      ? newIngestCollection.trim()
      : ingestCollection.trim();
    if (!resolvedCollection) {
      setIngestMessage("Choose a collection or create a new one before ingesting.");
      return;
    }
    setIsIngesting(true);
    setIngestMessage(null);
    try {
      const payload: {
        totalChunks?: number;
        acceptedFiles?: number;
        rejectedFiles?: number;
      } = await gatewayRequest("knowledge.ingest", {
        files: ingestFiles,
        options: {
          collection: resolvedCollection,
          chunkSize: ingestChunkSize,
          overlap: ingestChunkOverlap,
        },
        sessionKey: currentSessionKey,
      });
      const chunks = Number(payload?.totalChunks ?? 0);
      const accepted = Number(payload?.acceptedFiles ?? ingestFiles.length);
      const rejected = Number(payload?.rejectedFiles ?? 0);
      if (creatingIngestCollection && resolvedCollection) {
        setIngestCollections((prev) =>
          Array.from(new Set([...prev, resolvedCollection.trim()])).sort((a, b) =>
            a.localeCompare(b),
          ),
        );
        setIngestCollection(resolvedCollection.trim());
        setCreatingIngestCollection(false);
        setNewIngestCollection("");
      }
      setIngestMessage(
        `Ingested ${chunks} chunks from ${accepted} file(s). Rejected: ${rejected}.`,
      );
    } catch (err) {
      setIngestMessage(`Ingest failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setIsIngesting(false);
    }
  };

  useEffect(() => {
    if (!showIngestModal) return;
    let cancelled = false;

    const loadCollections = async () => {
      setIngestCollectionsLoading(true);
      try {
        let names: string[] = [];
        if (gatewayRequest) {
          const payload = await gatewayRequest<{
            collections?: Array<{ collection?: string }>;
          }>("knowledge.collections.list", {
            options: { includeInaccessible: false },
          }).catch(() => null);
          if (Array.isArray(payload?.collections)) {
            names = payload.collections
              .map((entry) =>
                typeof entry?.collection === "string" ? entry.collection.trim() : "",
              )
              .filter((entry) => Boolean(entry));
          }
        }

        if (names.length === 0) {
          const response = await fetch("/api/settings/knowledge/collections");
          if (response.ok) {
            const payload = (await response.json()) as {
              collections?: Array<{ collection?: string }>;
            };
            if (Array.isArray(payload?.collections)) {
              names = payload.collections
                .map((entry) =>
                  typeof entry?.collection === "string" ? entry.collection.trim() : "",
                )
                .filter((entry) => Boolean(entry));
            }
          }
        }

        const deduped = Array.from(new Set(["default", ...names])).sort((a, b) =>
          a.localeCompare(b),
        );
        if (!cancelled) {
          setIngestCollections(deduped);
          setIngestCollection((prev) =>
            deduped.includes(prev.trim()) ? prev : deduped[0] || "default",
          );
        }
      } catch (err) {
        if (!cancelled) {
          setIngestMessage(`Unable to load collections: ${String((err as Error)?.message || err)}`);
          setIngestCollections(["default"]);
        }
      } finally {
        if (!cancelled) {
          setIngestCollectionsLoading(false);
        }
      }
    };

    void loadCollections();
    return () => {
      cancelled = true;
    };
  }, [showIngestModal, gatewayRequest]);

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/") || item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleFileSelect(file);
          return;
        }
      }
    }

    // For text paste: after paste completes, move cursor to end and auto-resize
    const el = inputRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = el.value.length;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 140) + "px";
      });
    }
  };

  const hasDraggedFiles = (e: React.DragEvent) => {
    const types = e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : [];
    return types.includes("Files");
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (files) {
      for (const file of Array.from(files)) {
        handleFileSelect(file);
      }
    }
  };

  const handleAttachmentInputFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      handleFileSelect(file);
    }
    if (fileInputRef.current) {
      // Ensure selecting the same file again still emits an input/change event.
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && e.currentTarget.contains(relatedTarget)) return;
    setIsDragging(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // If command dropdown is showing and user hits Enter, select the highlighted command
    if (showCmdDropdown && filteredCommands.length > 0) {
      const selected = filteredCommands[cmdSelectedIdx] || filteredCommands[0];
      selectCommand(selected);
      return;
    }

    const hasAttachments = attachedImage || attachedFiles.length > 0;
    if (input.trim() || hasAttachments) {
      const messageText = input.trim();

      // Route slash commands through onCommand handler
      if (messageText.startsWith("/") && onCommand && !hasAttachments) {
        const spaceIdx = messageText.indexOf(" ");
        const cmdName = spaceIdx > 0 ? messageText.slice(1, spaceIdx) : messageText.slice(1);
        const cmdArgs = spaceIdx > 0 ? messageText.slice(spaceIdx + 1).trim() : undefined;
        // Find matching command
        const match = commands.find((c) =>
          c.aliases.some((a) => a.toLowerCase() === `/${cmdName.toLowerCase()}`),
        );
        if (match) {
          onCommand(match.key, cmdArgs);
          setInput("");
          if (inputRef.current) inputRef.current.style.height = "auto";
          return;
        }
      }

      // Collect all attachments (image + documents)
      const allAttachments: ChatAttachment[] = [...attachedFiles];
      if (attachedImage) {
        const imgMatch = attachedImage.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (imgMatch) {
          allAttachments.unshift({
            type: "image",
            mimeType: imgMatch[1],
            fileName: "image.png",
            content: imgMatch[2],
          });
        }
      }

      // While loading: cue locally or steer into the active run.
      if (isLoading && messageText) {
        const packedAttachments = allAttachments.length > 0 ? allAttachments : undefined;
        if (busyMode === "steer" && onSteer) {
          onSteer(messageText, attachedImage || undefined, packedAttachments);
        } else if (onQueue) {
          onQueue(messageText, attachedImage || undefined, packedAttachments);
        }
        setInput("");
        setAttachedImage(null);
        setAttachedFiles([]);
        setAttachmentError(null);
        if (inputRef.current) inputRef.current.style.height = "auto";
        return;
      }

      // Build prompt — summarize attached files in the message for context
      let prompt = messageText;
      if (!prompt && attachedImage && attachedFiles.length === 0) {
        prompt = "Analyze this image and describe what you see.";
      } else if (!prompt && attachedFiles.length > 0) {
        const names = attachedFiles.map((f) => f.fileName).join(", ");
        prompt = `Review these files: ${names}`;
      }

      onSend(
        prompt,
        attachedImage || undefined,
        allAttachments.length > 0 ? allAttachments : undefined,
      );

      setInput("");
      setAttachedImage(null);
      setAttachedFiles([]);
      setAttachmentError(null);
      if (inputRef.current) inputRef.current.style.height = "auto";
    }
  };

  return (
    <>
      {lightboxSrc &&
        createPortal(
          <MediaLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />,
          document.body,
        )}
      {showIngestModal &&
        createPortal(
          <div className="fixed inset-0 z-[120] bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-[#0e1224] border border-white/15 rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div>
                  <div className="text-white font-semibold">Knowledge Ingest</div>
                  <div className="text-xs text-white/50">
                    Explicit pipeline: chunk + embed + citation pointers. Separate from chat sends.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIngestModal(false)}
                  className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <input
                  id={ingestInputId}
                  ref={ingestFileInputRef}
                  type="file"
                  accept=".md,.txt,.csv,.json,.xml,.yaml,.yml,.log,.js,.ts,.jsx,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.css,.html,.sql,.sh,.toml,.ini,.pdf,.docx,.xlsx,.doc,.xls,.rtf,.svg"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files) {
                      for (const file of Array.from(files)) handleIngestFileSelect(file);
                    }
                    e.target.value = "";
                  }}
                />
                <div className="flex items-center gap-2">
                  <label
                    htmlFor={ingestInputId}
                    onClick={() => {
                      if (ingestFileInputRef.current) {
                        ingestFileInputRef.current.value = "";
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      ingestFileInputRef.current?.click();
                    }}
                    role="button"
                    tabIndex={0}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm cursor-pointer"
                  >
                    Add Files
                  </label>
                  <div className="text-xs text-white/50">
                    {ingestFiles.length} file(s) queued for ingest
                  </div>
                </div>

                {ingestFiles.length > 0 && (
                  <div className="max-h-44 overflow-y-auto space-y-1">
                    {ingestFiles.map((file, idx) => (
                      <div
                        key={`${file.fileName}-${idx}`}
                        className="flex items-center gap-2 px-2 py-1 rounded bg-white/5 border border-white/10 text-xs"
                      >
                        <FileText className="w-3 h-3 text-purple-300" />
                        <span className="text-white/80 truncate flex-1">{file.fileName}</span>
                        <span className="text-white/40">{file.mimeType || "unknown"}</span>
                        <button
                          type="button"
                          onClick={() => setIngestFiles((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-0.5 rounded hover:bg-white/10 text-white/50"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <label className="text-xs text-white/60 relative">
                    <div className="flex items-center justify-between">
                      <span>Collection</span>
                      <button
                        type="button"
                        onClick={() => setShowIngestHelp((prev) => !prev)}
                        className="p-0.5 rounded text-white/40 hover:text-white/80 hover:bg-white/10"
                        title="Knowledge ingest help"
                      >
                        <CircleHelp className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <select
                      value={creatingIngestCollection ? "__new__" : ingestCollection}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === "__new__") {
                          setCreatingIngestCollection(true);
                          return;
                        }
                        setCreatingIngestCollection(false);
                        setNewIngestCollection("");
                        setIngestCollection(next);
                      }}
                      className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white"
                      disabled={ingestCollectionsLoading}
                    >
                      {ingestCollections.map((entry) => (
                        <option key={entry} value={entry} className="bg-[#0e1224] text-white">
                          {entry}
                        </option>
                      ))}
                      <option value="__new__" className="bg-[#0e1224] text-white">
                        + Create new collection
                      </option>
                    </select>
                    {creatingIngestCollection && (
                      <input
                        value={newIngestCollection}
                        onChange={(e) => setNewIngestCollection(e.target.value)}
                        placeholder="New collection name"
                        className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white placeholder:text-white/30"
                      />
                    )}
                    {ingestCollectionsLoading && (
                      <div className="mt-1 text-[11px] text-white/40">Loading collections...</div>
                    )}
                  </label>
                  <label className="text-xs text-white/60">
                    Chunk Size
                    <select
                      value={ingestChunkSize}
                      onChange={(e) => setIngestChunkSize(Number(e.target.value) || 1800)}
                      className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white"
                    >
                      {INGEST_CHUNK_SIZE_PRESETS.map((entry) => (
                        <option
                          key={`chunk-${entry.value}`}
                          value={entry.value}
                          className="bg-[#0e1224] text-white"
                        >
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-white/60">
                    Overlap
                    <select
                      value={ingestChunkOverlap}
                      onChange={(e) => setIngestChunkOverlap(Number(e.target.value) || 200)}
                      className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white"
                    >
                      {INGEST_OVERLAP_PRESETS.map((entry) => (
                        <option
                          key={`overlap-${entry.value}`}
                          value={entry.value}
                          className="bg-[#0e1224] text-white"
                        >
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {showIngestHelp && (
                  <div className="text-xs text-white/75 bg-white/5 border border-white/10 rounded-lg px-3 py-2 space-y-1">
                    <div>
                      <span className="text-white font-medium">Collections:</span> Buckets of
                      related documents. Use one collection per topic/team so retrieval stays
                      precise.
                    </div>
                    <div>
                      <span className="text-white font-medium">Chunk Size:</span>{" "}
                      {INGEST_CHUNK_SIZE_PRESETS.find((entry) => entry.value === ingestChunkSize)
                        ?.reason || "Controls how much text is embedded per chunk."}
                    </div>
                    <div>
                      <span className="text-white font-medium">Overlap:</span>{" "}
                      {INGEST_OVERLAP_PRESETS.find((entry) => entry.value === ingestChunkOverlap)
                        ?.reason || "Controls repeated text between adjacent chunks."}
                    </div>
                  </div>
                )}

                {ingestMessage && (
                  <div className="text-xs text-white/70 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                    {ingestMessage}
                  </div>
                )}
              </div>

              <div className="px-4 py-3 border-t border-white/10 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowIngestModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm text-white"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={ingestFiles.length === 0 || isIngesting}
                  onClick={handleKnowledgeIngest}
                  className="px-3 py-1.5 rounded-lg bg-purple-500/80 hover:bg-purple-500 disabled:bg-white/10 disabled:text-white/30 text-sm text-white"
                >
                  {isIngesting ? "Ingesting..." : "Ingest to Knowledge"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      <div
        className="glass-panel rounded-2xl p-4 h-full flex flex-col min-w-0"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* Header with session + audio controls */}
        <div className="flex flex-wrap items-start justify-between gap-2 mb-4 min-w-0">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {onToggleSessions && (
              <button
                onClick={onToggleSessions}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-all"
                title="Sessions"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-white/90 font-semibold text-lg truncate max-w-[120px] sm:max-w-[220px]">
              {sessionTitle || "Chat"}
            </h2>
            {onChangeChatAgent && chatAgentOptions.length > 1 && (
              <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                  Chat Agent
                </span>
                <select
                  value={chatAgentId || chatAgentOptions[0]?.id || ""}
                  onChange={(e) => onChangeChatAgent(e.target.value)}
                  className="bg-transparent text-sm text-white/80 focus:outline-none cursor-pointer"
                  title="Choose who this chat talks to"
                >
                  {chatAgentOptions.map((option) => (
                    <option key={option.id} value={option.id} className="bg-gray-900 text-white">
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {onNewChat && (
              <button
                onClick={onNewChat}
                className="p-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 transition-all"
                title="New chat"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => (onCommand ? onCommand("compact") : onSend("/compact"))}
              className="p-1 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/70 transition-all"
              title="Compact conversation (save context)"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                const next = !compactThinking;
                setCompactThinking(next);
                localStorage.setItem("argent-compact-thinking", String(next));
              }}
              className={`p-1 rounded-lg transition-all ${
                compactThinking
                  ? "bg-purple-500/20 text-purple-400"
                  : "hover:bg-white/10 text-white/40 hover:text-white/70"
              }`}
              title={
                compactThinking
                  ? "Showing 'Thinking...' (click to show stream)"
                  : "Showing live stream (click to hide)"
              }
            >
              {compactThinking ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
            </button>
            {contextUsage &&
              contextUsage.total > 0 &&
              (() => {
                const pct = Math.min(100, (contextUsage.used / contextUsage.total) * 100);
                const colorClass =
                  pct < 50
                    ? "bg-emerald-400"
                    : pct < 75
                      ? "bg-yellow-400"
                      : pct < 90
                        ? "bg-orange-400"
                        : "bg-red-400";
                const textColor =
                  pct < 50
                    ? "text-emerald-400"
                    : pct < 75
                      ? "text-yellow-400"
                      : pct < 90
                        ? "text-orange-400"
                        : "text-red-400";
                const usedK =
                  contextUsage.used >= 1000
                    ? `${Math.round(contextUsage.used / 1000)}k`
                    : String(contextUsage.used);
                const totalK =
                  contextUsage.total >= 1000
                    ? `${Math.round(contextUsage.total / 1000)}k`
                    : String(contextUsage.total);
                return (
                  <div
                    className="flex items-center gap-1.5 text-xs"
                    title={`${usedK} / ${totalK} tokens`}
                  >
                    <div className="w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`${textColor} font-mono text-[10px]`}>{Math.round(pct)}%</span>
                    {contextUsage.estimated ? (
                      <span className="text-[10px] text-white/45">estimating...</span>
                    ) : null}
                  </div>
                );
              })()}
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/70 transition-all"
                title="Collapse chat"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2 items-center flex-wrap justify-end ml-auto">
            <button
              onClick={onToggleMic}
              className={`p-2 rounded-lg transition-all relative ${
                isProcessingSpeech
                  ? "bg-yellow-500/20 text-yellow-400"
                  : speechError
                    ? "bg-red-500/20 text-red-400"
                    : micEnabled
                      ? isListening
                        ? "bg-red-500/20 text-red-400 animate-pulse"
                        : "bg-green-500/20 text-green-400"
                      : "bg-white/5 text-white/40 hover:bg-white/10"
              }`}
              title={
                isProcessingSpeech
                  ? "Processing speech..."
                  : speechError
                    ? `Mic error: ${speechError}`
                    : micEnabled
                      ? "Disable microphone"
                      : "Enable microphone"
              }
            >
              {isProcessingSpeech ? (
                <div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
              ) : micEnabled ? (
                <Mic className="w-5 h-5" />
              ) : (
                <MicOff className="w-5 h-5" />
              )}
            </button>
            <button
              onClick={onToggleAudio}
              className={`p-2 rounded-lg transition-all ${
                audioEnabled
                  ? "bg-purple-500/20 text-purple-400"
                  : "bg-white/5 text-white/40 hover:bg-white/10"
              }`}
              title={audioEnabled ? "Disable voice" : "Enable voice"}
            >
              {audioEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            {onCycleTtsDisplayMode && (
              <button
                onClick={onCycleTtsDisplayMode}
                className="px-2 py-1.5 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/85 transition-all text-[10px] font-medium border border-white/10"
                title={`TTS Display: ${ttsDisplayMode}`}
              >
                {ttsDisplayMode === "text-voice"
                  ? "Text+Voice"
                  : ttsDisplayMode === "voice-first"
                    ? "Voice-first"
                    : "Voice-only"}
              </button>
            )}
            <button
              onClick={onToggleDeepThink}
              className={`p-2 rounded-lg transition-all ${
                deepThinkMode
                  ? "bg-yellow-500/30 text-yellow-400"
                  : "bg-white/5 text-white/40 hover:bg-white/10"
              }`}
              title={
                deepThinkMode ? "Deep Think ON (Powerful tier + max reasoning)" : "Deep Think OFF"
              }
            >
              <span className="text-lg">{deepThinkMode ? "💡" : "🔅"}</span>
            </button>
            <button
              onClick={onToggleDeepResearch}
              className={`p-2 rounded-lg transition-all ${
                deepResearchMode
                  ? "bg-cyan-500/30 text-cyan-300"
                  : "bg-white/5 text-white/40 hover:bg-white/10"
              }`}
              title={
                deepResearchMode
                  ? "Research Mode ON (20 results / 20 searches target)"
                  : "Research Mode OFF (10 results / 10 searches target)"
              }
            >
              <span className="text-lg">{deepResearchMode ? "🔎" : "🔍"}</span>
            </button>
            {onToggleCanvas && (
              <button
                onClick={onToggleCanvas}
                className={`p-2 rounded-lg transition-all ${
                  canvasOpen
                    ? "bg-purple-500/20 text-purple-400"
                    : "bg-white/5 text-white/40 hover:bg-white/10"
                }`}
                title={canvasOpen ? "Hide Canvas" : "Show Canvas"}
              >
                <span className="text-lg">📋</span>
              </button>
            )}
            <AudioDeviceSelector
              selectedInput={selectedInput}
              selectedOutput={selectedOutput}
              selectedVoice={selectedVoice}
              activeVoiceLabel={activeVoiceLabel}
              voiceSelectionLocked={voiceSelectionLocked}
              onInputChange={onInputChange}
              onOutputChange={onOutputChange}
              onVoiceChange={onVoiceChange}
            />
          </div>
        </div>

        {routingTelemetry?.counters && (
          <div className="mb-3 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-white/45">Routing</span>
            <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/25">
              family {routingTelemetry.counters.dispatchRouteFamily ?? 0}
            </span>
            <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/25">
              sub-agent {routingTelemetry.counters.dispatchRouteSubagent ?? 0}
            </span>
            <span className="px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-300 border border-yellow-500/25">
              blocked spawn {routingTelemetry.counters.spawnDirectBlocked ?? 0}
            </span>
            <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/25">
              failures {routingTelemetry.counters.dispatchFailure ?? 0}
            </span>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 mb-4">
          <AnimatePresence mode="popLayout">
            {messages.map((msg, idx) => {
              // Detect if this is the actively streaming message
              const isStreamingMsg =
                isLoading && msg.role === "assistant" && idx === messages.length - 1;

              // In compact mode, show "Thinking..." instead of raw stream
              const showCompactThinking = isStreamingMsg && compactThinking && msg.content;

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 group/msg ${
                      msg.role === "user"
                        ? "bg-purple-500/30 text-white"
                        : msg.toolsUsed && msg.toolsUsed.length > 0
                          ? "bg-indigo-500/8 border border-indigo-400/15 text-white/90"
                          : "bg-white/10 text-white/90"
                    }`}
                  >
                    {msg.image && (
                      <img
                        src={msg.image}
                        alt="Attached"
                        className="max-w-full rounded-lg mb-2 border border-white/20 cursor-pointer hover:brightness-110 transition-all"
                        onClick={() => setLightboxSrc(msg.image!)}
                      />
                    )}
                    {showCompactThinking ? (
                      <div className="flex items-center gap-2 py-1">
                        <div className="flex gap-1">
                          <span
                            className="w-1.5 h-1.5 bg-purple-400/60 rounded-full animate-bounce"
                            style={{ animationDelay: "0ms" }}
                          />
                          <span
                            className="w-1.5 h-1.5 bg-purple-400/60 rounded-full animate-bounce"
                            style={{ animationDelay: "150ms" }}
                          />
                          <span
                            className="w-1.5 h-1.5 bg-purple-400/60 rounded-full animate-bounce"
                            style={{ animationDelay: "300ms" }}
                          />
                        </div>
                        <span className="text-white/40 text-sm italic">Thinking...</span>
                      </div>
                    ) : msg.role === "assistant" &&
                      msg.ttsSummary &&
                      ttsDisplayMode === "voice-only" ? null : msg.role === "assistant" &&
                      msg.ttsSummary &&
                      ttsDisplayMode === "voice-first" ? (
                      <details className="text-xs text-white/60 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
                        <summary className="cursor-pointer select-none text-white/70">
                          Show full text
                        </summary>
                        <div className="mt-1">
                          <MessageContent
                            content={msg.content}
                            role={msg.role}
                            onImageClick={setLightboxSrc}
                          />
                        </div>
                      </details>
                    ) : (
                      <MessageContent
                        content={msg.content}
                        role={msg.role}
                        onImageClick={setLightboxSrc}
                      />
                    )}
                    {msg.role === "assistant" &&
                      (msg.modelInfo ||
                        (msg.toolsUsed && msg.toolsUsed.length > 0) ||
                        msg.mood ||
                        msg.familySource) && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap border-t border-white/5 pt-1.5">
                          {msg.familySource && (
                            <span
                              className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                              style={{
                                backgroundColor: "rgba(168, 85, 247, 0.12)",
                                color: "rgba(168, 85, 247, 0.8)",
                                border: "1px solid rgba(168, 85, 247, 0.25)",
                              }}
                            >
                              👨‍👩‍👧 via {msg.familySource}
                            </span>
                          )}
                          {msg.mood &&
                            (() => {
                              const moodColor = getMoodColor(msg.mood as MoodName);
                              const moodIcon = getMoodIcon(msg.mood as MoodName);
                              return (
                                <span
                                  className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                                  style={{
                                    backgroundColor: `${moodColor}20`,
                                    color: `${moodColor}cc`,
                                    border: `1px solid ${moodColor}40`,
                                  }}
                                >
                                  {moodIcon} {msg.mood}
                                </span>
                              );
                            })()}
                          {msg.modelInfo && (
                            <span className="flex items-center gap-1">
                              <span
                                className={`inline-block w-2.5 h-2.5 rounded-full ${
                                  msg.modelInfo.tier === "local"
                                    ? "bg-green-400"
                                    : msg.modelInfo.tier === "fast"
                                      ? "bg-yellow-400"
                                      : msg.modelInfo.tier === "balanced"
                                        ? "bg-blue-400"
                                        : "bg-purple-400"
                                }`}
                              />
                              <span className="text-xs text-white/40">
                                {msg.modelInfo.model.replace(/-20\d{6}$/, "")}
                              </span>
                            </span>
                          )}
                          {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                            <>
                              {(msg.modelInfo || msg.mood) && (
                                <span className="text-white/10">|</span>
                              )}
                              {msg.toolsUsed.map((tool) => (
                                <span
                                  key={tool}
                                  className="text-xs px-1.5 py-0.5 rounded bg-white/8 text-white/50 border border-white/15"
                                >
                                  {tool}
                                </span>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    {msg.role === "assistant" && msg.ttsSummary && (
                      <TTSSummary summary={msg.ttsSummary} audioUrl={msg.ttsAudioUrl} />
                    )}
                    {/* Thumbs up/down feedback */}
                    {msg.role === "assistant" && (
                      <div
                        className={`flex items-center gap-1 mt-1.5 ${msg.feedback ? "" : "opacity-0 group-hover/msg:opacity-100"} transition-opacity`}
                      >
                        <button
                          onClick={() => onFeedback?.(msg.id, "up")}
                          className={`p-1 rounded transition-all ${
                            msg.feedback === "up"
                              ? "text-green-400 bg-green-500/20"
                              : "text-white/25 hover:text-green-400 hover:bg-green-500/10"
                          }`}
                          title="Good response (+3 points)"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onFeedback?.(msg.id, "down")}
                          className={`p-1 rounded transition-all ${
                            msg.feedback === "down"
                              ? "text-red-400 bg-red-500/20"
                              : "text-white/25 hover:text-red-400 hover:bg-red-500/10"
                          }`}
                          title="Bad/false response (-10 points)"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                        {msg.feedback && (
                          <span
                            className={`text-[10px] ml-1 ${
                              msg.feedback === "up" ? "text-green-400/60" : "text-red-400/60"
                            }`}
                          >
                            {msg.feedback === "up" ? "+3" : "-10"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div
                className={`rounded-2xl px-4 py-3 min-w-[120px] ${activeTool ? "bg-indigo-500/8 border border-indigo-400/15" : "bg-white/10"}`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span
                      className="w-2 h-2 bg-white/40 rounded-full animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="w-2 h-2 bg-white/40 rounded-full animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="w-2 h-2 bg-white/40 rounded-full animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                  {(activeModelInfo || activeTool) && (
                    <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                      {activeModelInfo && (
                        <span className="flex items-center gap-1">
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${
                              activeModelInfo.tier === "local"
                                ? "bg-green-400"
                                : activeModelInfo.tier === "fast"
                                  ? "bg-yellow-400"
                                  : activeModelInfo.tier === "balanced"
                                    ? "bg-blue-400"
                                    : "bg-purple-400"
                            }`}
                          />
                          <span>{activeModelInfo.model.replace(/-20\d{6}$/, "")}</span>
                        </span>
                      )}
                      {activeTool && (
                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300/80 border border-cyan-500/30 animate-pulse">
                          {activeTool}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Queued messages */}
          {queuedMessages.length > 0 && (
            <div className="space-y-2">
              {queuedMessages.map((qm, idx) => (
                <motion.div
                  key={`q-${idx}`}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-end"
                >
                  <div className="max-w-[80%] rounded-2xl px-4 py-2 bg-purple-500/10 text-white/50 border border-purple-500/20 relative group">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                        Queued #{idx + 1}
                      </span>
                      {onDequeue && (
                        <button
                          onClick={() => onDequeue(idx)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-all"
                          title="Remove from queue"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <p className="text-sm">{qm.content}</p>
                    {qm.image && (
                      <img
                        src={qm.image}
                        alt="Queued"
                        className="max-h-16 rounded mt-1 opacity-50"
                      />
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="space-y-2">
          {/* Image Preview */}
          {attachedImage && (
            <div className="relative inline-block">
              <img
                src={attachedImage}
                alt="Attached"
                className="max-h-32 rounded-lg border border-white/20"
              />
              <button
                type="button"
                onClick={() => setAttachedImage(null)}
                className="absolute -top-2 -right-2 p-1 bg-red-500/80 hover:bg-red-500 text-white rounded-full transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Document Attachment Chips */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              {attachedFiles.map((file, idx) => (
                <div
                  key={`${file.fileName}-${idx}`}
                  className="flex items-center gap-1.5 px-2 py-1 bg-purple-500/15 border border-purple-500/30 rounded-lg text-xs text-purple-300"
                >
                  <FileText className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate max-w-[150px]">{file.fileName}</span>
                  <button
                    type="button"
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-0.5 hover:bg-purple-500/30 rounded transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachmentError && (
            <div className="px-3 pt-2 text-xs text-rose-300">{attachmentError}</div>
          )}

          {/* Drag Overlay */}
          {isDragging && (
            <div className="absolute inset-0 bg-purple-500/20 border-2 border-dashed border-purple-400 rounded-xl flex items-center justify-center pointer-events-none">
              <div className="text-purple-400 font-medium">Drop files here</div>
            </div>
          )}

          {/* Doc Focus Badge */}
          {focusDoc && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-lg">
              <FileText className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-purple-300 text-xs font-medium truncate max-w-[200px]">
                {focusDoc.title}
              </span>
              <button
                type="button"
                onClick={onClearFocus}
                className="ml-auto text-white/30 hover:text-white/60 transition-colors"
                title="Clear document focus"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Command Autocomplete Dropdown */}
          <AnimatePresence>
            {showCmdDropdown && (
              <motion.div
                ref={cmdDropdownRef}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15 }}
                className="bg-[#1a1a2e]/95 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden shadow-xl max-h-[240px] overflow-y-auto mb-2"
              >
                {filteredCommands.slice(0, 10).map((cmd, idx) => (
                  <button
                    key={cmd.key}
                    type="button"
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                      idx === cmdSelectedIdx
                        ? "bg-purple-500/20 text-white"
                        : "text-white/70 hover:bg-white/5"
                    }`}
                    onMouseEnter={() => setCmdSelectedIdx(idx)}
                    onClick={() => selectCommand(cmd)}
                  >
                    <span className="text-purple-400 font-mono text-sm font-medium min-w-[100px]">
                      {cmd.aliases[0]}
                    </span>
                    <span className="text-white/40 text-xs truncate">{cmd.description}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input Card — ChatGPT-style stacked layout */}
          <div className="bg-white/5 border border-white/10 rounded-2xl focus-within:border-purple-500/50 focus-within:ring-1 focus-within:ring-purple-500/30 transition-all">
            <input
              id={attachmentInputId}
              type="file"
              ref={fileInputRef}
              accept="image/*,.md,.txt,.csv,.json,.xml,.yaml,.yml,.log,.js,.ts,.jsx,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.css,.html,.sql,.sh,.toml,.ini,.pdf,.docx,.xlsx,.doc,.xls,.rtf,.svg"
              multiple
              onInput={(e) => handleAttachmentInputFiles(e.currentTarget.files)}
              onChange={(e) => handleAttachmentInputFiles(e.target.files)}
              className="hidden"
            />

            {/* Textarea — full width */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
              }}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                // Command dropdown navigation
                if (showCmdDropdown) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCmdSelectedIdx((i) => Math.min(i + 1, filteredCommands.length - 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCmdSelectedIdx((i) => Math.max(i - 1, 0));
                    return;
                  }
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const selected = filteredCommands[cmdSelectedIdx];
                    if (selected) selectCommand(selected);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setInput("");
                    return;
                  }
                }
                if (e.key === "Enter") {
                  if (e.shiftKey) {
                    if (isLoading && input.trim()) {
                      e.preventDefault();
                      onInterrupt?.(input.trim());
                      setInput("");
                      setAttachedImage(null);
                      if (inputRef.current) inputRef.current.style.height = "auto";
                    }
                  } else {
                    e.preventDefault();
                    if (input.trim() || attachedImage || attachedFiles.length > 0) {
                      const form = e.currentTarget.closest("form");
                      if (form) form.requestSubmit();
                    }
                  }
                }
              }}
              placeholder={
                isListening
                  ? "Listening..."
                  : isProcessingSpeech
                    ? "Processing speech..."
                    : isLoading
                      ? busyMode === "steer"
                        ? "Type to steer (Shift+Enter to interrupt)..."
                        : "Type to cue (Shift+Enter to interrupt)..."
                      : "Ask anything..."
              }
              disabled={isListening}
              rows={1}
              className="w-full bg-transparent px-4 pt-3 pb-1 text-white placeholder-white/30 focus:outline-none disabled:opacity-50 resize-none overflow-hidden text-sm"
            />

            {/* Action toolbar */}
            <div className="flex items-center justify-between px-3 pb-2 pt-1">
              {/* Left actions */}
              <div className="flex items-center gap-1">
                <label
                  htmlFor={attachmentInputId}
                  className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/5 rounded-lg transition-all cursor-pointer block"
                  title="Attach files"
                  aria-label="Attach files"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <Paperclip className="w-4 h-4" />
                </label>
                <button
                  type="button"
                  onClick={() => setShowIngestModal(true)}
                  className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/5 rounded-lg transition-all"
                  title="Ingest to knowledge base"
                >
                  <Database className="w-4 h-4" />
                </button>
                {onToggleDeepThink && (
                  <button
                    type="button"
                    onClick={onToggleDeepThink}
                    className={`p-1.5 rounded-lg transition-all ${
                      deepThinkMode
                        ? "text-purple-400 bg-purple-500/20"
                        : "text-white/40 hover:text-white/70 hover:bg-white/5"
                    }`}
                    title={deepThinkMode ? "Deep think ON" : "Deep think OFF"}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                      />
                    </svg>
                  </button>
                )}
              </div>

              {/* Right actions */}
              <div className="flex items-center gap-1">
                {onBusyModeChange && (
                  <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-lg bg-white/5 border border-white/10">
                    <button
                      type="button"
                      onClick={() => onBusyModeChange("cue")}
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${
                        busyMode === "cue"
                          ? "bg-purple-500/25 text-purple-300"
                          : "text-white/40 hover:text-white/70"
                      }`}
                      title="Queue after current run"
                    >
                      Cue
                    </button>
                    <button
                      type="button"
                      onClick={() => onBusyModeChange("steer")}
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${
                        busyMode === "steer"
                          ? "bg-cyan-500/25 text-cyan-300"
                          : "text-white/40 hover:text-white/70"
                      }`}
                      title="Inject into current run"
                    >
                      Steer
                    </button>
                  </div>
                )}
                {/* Stop button */}
                {(isSpeaking || isLoading) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isSpeaking) onStopTTS?.();
                      if (isLoading) {
                        if (input.trim()) {
                          onInterrupt?.(input.trim());
                          setInput("");
                          setAttachedImage(null);
                        } else {
                          onInterrupt?.("");
                        }
                      }
                    }}
                    className="p-1.5 text-red-400 hover:bg-red-500/20 rounded-lg transition-all relative"
                    title={
                      isSpeaking
                        ? "Stop speaking"
                        : input.trim()
                          ? "Stop & send"
                          : "Stop generating"
                    }
                  >
                    <Square className="w-4 h-4" />
                    {queuedMessages.length > 0 && (
                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-purple-500 text-white text-[8px] rounded-full flex items-center justify-center">
                        {queuedMessages.length}
                      </span>
                    )}
                  </button>
                )}

                {/* Send button */}
                <button
                  type="submit"
                  disabled={!input.trim() && !attachedImage && attachedFiles.length === 0}
                  className="p-1.5 bg-purple-500/80 hover:bg-purple-500 disabled:bg-white/10 disabled:text-white/20 text-white rounded-lg transition-all disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
