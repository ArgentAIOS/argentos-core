import type * as monacoTypes from "monaco-editor";
import Editor, { loader } from "@monaco-editor/react";
import {
  ChevronDown,
  ChevronRight,
  Code,
  File,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FilePlus,
  Palette,
  X as XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Editor Themes
// ---------------------------------------------------------------------------

const EDITOR_THEMES = [
  { id: "vs-dark", label: "Dark (Default)" },
  { id: "argent-purple", label: "Argent Purple" },
  { id: "github-dark", label: "GitHub Dark" },
  { id: "monokai", label: "Monokai" },
  { id: "one-dark-pro", label: "One Dark Pro" },
  { id: "dracula", label: "Dracula" },
  { id: "vs-light", label: "Light" },
  { id: "hc-black", label: "High Contrast" },
] as const;

type EditorThemeId = (typeof EDITOR_THEMES)[number]["id"];

/** Register custom themes once Monaco loads */
function registerCustomThemes(monaco: typeof monacoTypes) {
  monaco.editor.defineTheme("argent-purple", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "7c7c7c", fontStyle: "italic" },
      { token: "keyword", foreground: "c586c0" },
      { token: "string", foreground: "ce9178" },
      { token: "number", foreground: "b5cea8" },
      { token: "type", foreground: "4ec9b0" },
    ],
    colors: {
      "editor.background": "#1a1625",
      "editor.foreground": "#e0dce8",
      "editor.lineHighlightBackground": "#2a2436",
      "editor.selectionBackground": "#6b21a844",
      "editorCursor.foreground": "#a855f7",
      "editor.selectionHighlightBackground": "#6b21a822",
      "editorLineNumber.foreground": "#5c5675",
      "editorLineNumber.activeForeground": "#a78bfa",
      "editorGutter.background": "#1a1625",
      "editorWidget.background": "#1e1a2e",
      "minimap.background": "#1a1625",
    },
  });

  monaco.editor.defineTheme("github-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8b949e", fontStyle: "italic" },
      { token: "keyword", foreground: "ff7b72" },
      { token: "string", foreground: "a5d6ff" },
      { token: "number", foreground: "79c0ff" },
      { token: "type", foreground: "ffa657" },
    ],
    colors: {
      "editor.background": "#0d1117",
      "editor.foreground": "#c9d1d9",
      "editor.lineHighlightBackground": "#161b22",
      "editor.selectionBackground": "#264f7844",
      "editorCursor.foreground": "#58a6ff",
      "editorLineNumber.foreground": "#484f58",
      "editorLineNumber.activeForeground": "#c9d1d9",
    },
  });

  monaco.editor.defineTheme("monokai", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "75715e", fontStyle: "italic" },
      { token: "keyword", foreground: "f92672" },
      { token: "string", foreground: "e6db74" },
      { token: "number", foreground: "ae81ff" },
      { token: "type", foreground: "66d9ef", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#272822",
      "editor.foreground": "#f8f8f2",
      "editor.lineHighlightBackground": "#3e3d32",
      "editor.selectionBackground": "#49483e",
      "editorCursor.foreground": "#f8f8f0",
      "editorLineNumber.foreground": "#90908a",
      "editorLineNumber.activeForeground": "#c2c2bf",
    },
  });

  monaco.editor.defineTheme("one-dark-pro", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5c6370", fontStyle: "italic" },
      { token: "keyword", foreground: "c678dd" },
      { token: "string", foreground: "98c379" },
      { token: "number", foreground: "d19a66" },
      { token: "type", foreground: "e5c07b" },
    ],
    colors: {
      "editor.background": "#282c34",
      "editor.foreground": "#abb2bf",
      "editor.lineHighlightBackground": "#2c313c",
      "editor.selectionBackground": "#3e4451",
      "editorCursor.foreground": "#528bff",
      "editorLineNumber.foreground": "#4b5263",
      "editorLineNumber.activeForeground": "#abb2bf",
    },
  });

  monaco.editor.defineTheme("dracula", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6272a4", fontStyle: "italic" },
      { token: "keyword", foreground: "ff79c6" },
      { token: "string", foreground: "f1fa8c" },
      { token: "number", foreground: "bd93f9" },
      { token: "type", foreground: "8be9fd", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#282a36",
      "editor.foreground": "#f8f8f2",
      "editor.lineHighlightBackground": "#44475a",
      "editor.selectionBackground": "#44475a",
      "editorCursor.foreground": "#f8f8f2",
      "editorLineNumber.foreground": "#6272a4",
      "editorLineNumber.activeForeground": "#f8f8f2",
    },
  });
}

let themesRegistered = false;

loader.init().then((monaco) => {
  if (!themesRegistered) {
    registerCustomThemes(monaco as any);
    themesRegistered = true;
  }
});

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface CodeFile {
  id: string;
  name: string;
  path: string; // e.g. "src/index.ts"
  content: string;
  language: string;
}

export interface CodeFolder {
  name: string;
  path: string;
  expanded: boolean;
  children: (CodeFile | CodeFolder)[];
}

export interface CodeEditorPanelProps {
  files: CodeFile[];
  folders?: string[]; // flat list of folder paths like ["src", "src/components"]
  activeFileId?: string;
  onFileChange?: (fileId: string, content: string) => void;
  onFileSelect?: (fileId: string) => void;
  onNewFile?: (folderPath: string, fileName: string) => void;
  onNewFolder?: (parentPath: string, folderName: string) => void;
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCodeFile(node: CodeFile | CodeFolder): node is CodeFile {
  return "id" in node && "content" in node;
}

/** Map file extension to a Monaco language id. */
function languageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    css: "css",
    scss: "scss",
    html: "html",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    sql: "sql",
    graphql: "graphql",
    dockerfile: "dockerfile",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    rb: "ruby",
    php: "php",
    lua: "lua",
    r: "r",
    vue: "html",
    svelte: "html",
  };
  return map[ext] || "plaintext";
}

/** Pick a lucide icon component based on file extension. */
function fileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "json") return FileJson;
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "cpp", "c", "rb", "php"].includes(ext))
    return Code;
  if (["md", "txt", "rst"].includes(ext)) return FileText;
  return File;
}

/**
 * Build a tree of CodeFolder / CodeFile nodes from the flat files array and
 * an optional list of folder paths.
 */
function buildTree(
  files: CodeFile[],
  folderPaths: string[],
  expandedPaths: Set<string>,
): CodeFolder {
  const root: CodeFolder = { name: "", path: "", expanded: true, children: [] };

  // Ensure all intermediate folders exist.
  const ensureFolder = (segments: string[]): CodeFolder => {
    let current = root;
    for (let i = 0; i < segments.length; i++) {
      const partialPath = segments.slice(0, i + 1).join("/");
      let child = current.children.find((c) => !isCodeFile(c) && c.path === partialPath) as
        | CodeFolder
        | undefined;
      if (!child) {
        child = {
          name: segments[i],
          path: partialPath,
          expanded: expandedPaths.has(partialPath),
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }
    return current;
  };

  // Create explicit folders first.
  for (const fp of folderPaths) {
    ensureFolder(fp.split("/"));
  }

  // Insert files into the tree.
  for (const file of files) {
    const segments = file.path.split("/");
    if (segments.length === 1) {
      root.children.push(file);
    } else {
      const parentSegments = segments.slice(0, -1);
      const parent = ensureFolder(parentSegments);
      parent.children.push(file);
    }
  }

  // Sort children: folders first (alphabetical), then files (alphabetical).
  const sortChildren = (folder: CodeFolder) => {
    folder.children.sort((a, b) => {
      const aIsFile = isCodeFile(a);
      const bIsFile = isCodeFile(b);
      if (aIsFile !== bIsFile) return aIsFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    for (const child of folder.children) {
      if (!isCodeFile(child)) sortChildren(child);
    }
  };
  sortChildren(root);

  return root;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  node: CodeFile | CodeFolder;
  depth: number;
  activeFileId: string | null;
  onSelectFile: (file: CodeFile) => void;
  onToggleFolder: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: CodeFile | CodeFolder) => void;
}

function TreeNode({
  node,
  depth,
  activeFileId,
  onSelectFile,
  onToggleFolder,
  onContextMenu,
}: TreeNodeProps) {
  if (isCodeFile(node)) {
    const Icon = fileIcon(node.name);
    const isActive = node.id === activeFileId;
    return (
      <button
        className={`flex items-center w-full text-left px-2 py-[3px] text-sm font-mono truncate transition-colors ${
          isActive
            ? "bg-purple-500/20 text-white"
            : "text-white/70 hover:bg-white/5 hover:text-white"
        }`}
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={() => onSelectFile(node)}
        onContextMenu={(e) => onContextMenu(e, node)}
        title={node.path}
      >
        <Icon className="w-4 h-4 mr-1.5 shrink-0 text-white/50" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  // Folder node
  const FolderIcon = node.expanded ? FolderOpen : Folder;
  const Chevron = node.expanded ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        className="flex items-center w-full text-left px-2 py-[3px] text-sm font-mono truncate text-white/80 hover:bg-white/5 hover:text-white transition-colors"
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={() => onToggleFolder(node.path)}
        onContextMenu={(e) => onContextMenu(e, node)}
        title={node.path}
      >
        <Chevron className="w-3.5 h-3.5 mr-1 shrink-0 text-white/40" />
        <FolderIcon className="w-4 h-4 mr-1.5 shrink-0 text-purple-400/80" />
        <span className="truncate">{node.name}</span>
      </button>
      {node.expanded &&
        node.children.map((child) => (
          <TreeNode
            key={isCodeFile(child) ? child.id : `folder-${child.path}`}
            node={child}
            depth={depth + 1}
            activeFileId={activeFileId}
            onSelectFile={onSelectFile}
            onToggleFolder={onToggleFolder}
            onContextMenu={onContextMenu}
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CodeEditorPanel({
  files,
  folders = [],
  activeFileId: controlledActiveFileId,
  onFileChange,
  onFileSelect,
  onNewFile,
  onNewFolder,
  onClose,
}: CodeEditorPanelProps) {
  // --- State ---
  const [editorTheme, setEditorTheme] = useState<EditorThemeId>("argent-purple");
  const [showThemePicker, setShowThemePicker] = useState(false);
  const themePickerRef = useRef<HTMLDivElement>(null);

  // Close theme picker on outside click
  useEffect(() => {
    if (!showThemePicker) return;
    const handleClick = (e: MouseEvent) => {
      if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
        setShowThemePicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showThemePicker]);

  const [openTabIds, setOpenTabIds] = useState<string[]>(() =>
    controlledActiveFileId ? [controlledActiveFileId] : [],
  );
  const [internalActiveId, setInternalActiveId] = useState<string | null>(
    controlledActiveFileId ?? null,
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    // Auto-expand folders that contain the initially active file.
    const initial = new Set<string>();
    if (controlledActiveFileId) {
      const f = files.find((f) => f.id === controlledActiveFileId);
      if (f) {
        const parts = f.path.split("/");
        for (let i = 1; i < parts.length; i++) {
          initial.add(parts.slice(0, i).join("/"));
        }
      }
    }
    return initial;
  });
  const [modifiedIds, setModifiedIds] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [isNewFileDialogOpen, setIsNewFileDialogOpen] = useState(false);
  const [isNewFolderDialogOpen, setIsNewFolderDialogOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemParentPath, setNewItemParentPath] = useState("");
  const newItemInputRef = useRef<HTMLInputElement>(null);

  const activeId = controlledActiveFileId ?? internalActiveId;

  // Sync controlled activeFileId into open tabs.
  useEffect(() => {
    if (controlledActiveFileId && !openTabIds.includes(controlledActiveFileId)) {
      setOpenTabIds((prev) => [...prev, controlledActiveFileId]);
    }
    if (controlledActiveFileId) {
      setInternalActiveId(controlledActiveFileId);
    }
  }, [controlledActiveFileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus input when dialog opens.
  useEffect(() => {
    if ((isNewFileDialogOpen || isNewFolderDialogOpen) && newItemInputRef.current) {
      newItemInputRef.current.focus();
    }
  }, [isNewFileDialogOpen, isNewFolderDialogOpen]);

  // --- Tree ---
  const tree = useMemo(
    () => buildTree(files, folders, expandedPaths),
    [files, folders, expandedPaths],
  );

  const fileMap = useMemo(() => {
    const m = new Map<string, CodeFile>();
    for (const f of files) m.set(f.id, f);
    return m;
  }, [files]);

  // --- Callbacks ---
  const selectFile = useCallback(
    (file: CodeFile) => {
      if (!openTabIds.includes(file.id)) {
        setOpenTabIds((prev) => [...prev, file.id]);
      }
      setInternalActiveId(file.id);
      onFileSelect?.(file.id);
    },
    [openTabIds, onFileSelect],
  );

  const closeTab = useCallback(
    (fileId: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      setOpenTabIds((prev) => {
        const next = prev.filter((id) => id !== fileId);
        if (activeId === fileId) {
          const idx = prev.indexOf(fileId);
          const newActive = next[Math.min(idx, next.length - 1)] ?? null;
          setInternalActiveId(newActive);
          if (newActive) onFileSelect?.(newActive);
        }
        return next;
      });
      setModifiedIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    },
    [activeId, onFileSelect],
  );

  const switchTab = useCallback(
    (fileId: string) => {
      setInternalActiveId(fileId);
      onFileSelect?.(fileId);
    },
    [onFileSelect],
  );

  const toggleFolder = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!activeId || value === undefined) return;
      const file = fileMap.get(activeId);
      if (!file) return;
      if (value !== file.content) {
        setModifiedIds((prev) => new Set(prev).add(activeId));
      } else {
        setModifiedIds((prev) => {
          const next = new Set(prev);
          next.delete(activeId);
          return next;
        });
      }
      onFileChange?.(activeId, value);
    },
    [activeId, fileMap, onFileChange],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, node: CodeFile | CodeFolder) => {
    e.preventDefault();
    console.log("[CodeEditorPanel] context-menu", isCodeFile(node) ? "file" : "folder", node.path);
  }, []);

  // --- Resize ---
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = ev.clientX - resizeRef.current.startX;
        const newWidth = Math.max(140, Math.min(500, resizeRef.current.startWidth + delta));
        setSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        resizeRef.current = null;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth],
  );

  // --- New file / folder dialogs ---
  const submitNewFile = useCallback(() => {
    const name = newItemName.trim();
    if (!name) return;
    onNewFile?.(newItemParentPath, name);
    setIsNewFileDialogOpen(false);
    setNewItemName("");
  }, [newItemName, newItemParentPath, onNewFile]);

  const submitNewFolder = useCallback(() => {
    const name = newItemName.trim();
    if (!name) return;
    onNewFolder?.(newItemParentPath, name);
    setIsNewFolderDialogOpen(false);
    setNewItemName("");
  }, [newItemName, newItemParentPath, onNewFolder]);

  // --- Active file ---
  const activeFile = activeId ? fileMap.get(activeId) : null;
  const editorLanguage = activeFile
    ? activeFile.language || languageFromPath(activeFile.path)
    : "plaintext";

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white select-none">
      {/* ---- Tab bar ---- */}
      <div className="flex items-center bg-gray-900 border-b border-white/10 min-h-[36px]">
        <div className="flex-1 flex items-center overflow-x-auto scrollbar-thin scrollbar-thumb-white/10">
          {openTabIds.map((id) => {
            const file = fileMap.get(id);
            if (!file) return null;
            const isActive = id === activeId;
            const isModified = modifiedIds.has(id);
            const Icon = fileIcon(file.name);
            return (
              <button
                key={id}
                className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border-r border-white/5 whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-gray-800 text-white border-b-2 border-b-purple-500"
                    : "text-white/50 hover:text-white/80 hover:bg-gray-800/60"
                }`}
                onClick={() => switchTab(id)}
              >
                <Icon className="w-3.5 h-3.5 shrink-0 text-white/40" />
                <span>{file.name}</span>
                {isModified && (
                  <span
                    className="w-2 h-2 rounded-full bg-white/60 shrink-0"
                    title="Unsaved changes"
                  />
                )}
                <span
                  className="ml-1 p-0.5 rounded hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => closeTab(id, e)}
                  title="Close tab"
                >
                  <XIcon className="w-3 h-3" />
                </span>
              </button>
            );
          })}
        </div>
        {/* Theme Picker */}
        <div className="relative" ref={themePickerRef}>
          <button
            className={`px-2 py-1 text-white/40 hover:text-white hover:bg-white/10 rounded transition-colors ${showThemePicker ? "bg-white/10 text-white" : ""}`}
            onClick={() => setShowThemePicker((v) => !v)}
            title="Editor Theme"
          >
            <Palette className="w-4 h-4" />
          </button>
          {showThemePicker && (
            <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-white/10 rounded-lg shadow-xl py-1 z-50 min-w-[180px]">
              {EDITOR_THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                    editorTheme === t.id
                      ? "bg-purple-500/20 text-purple-300"
                      : "text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                  onClick={() => {
                    setEditorTheme(t.id);
                    setShowThemePicker(false);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {onClose && (
          <button
            className="px-2 py-1 mr-1 text-white/40 hover:text-white hover:bg-white/10 rounded transition-colors"
            onClick={onClose}
            title="Close editor"
          >
            <XIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ---- Body: sidebar + editor ---- */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div
          className="flex flex-col bg-gray-900 border-r border-white/10 overflow-hidden shrink-0"
          style={{ width: sidebarWidth }}
        >
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/10 text-xs text-white/50 uppercase tracking-wider">
            <span>Explorer</span>
            <div className="flex items-center gap-0.5">
              <button
                className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                title="New File"
                onClick={() => {
                  setNewItemParentPath("");
                  setNewItemName("");
                  setIsNewFileDialogOpen(true);
                }}
              >
                <FilePlus className="w-3.5 h-3.5" />
              </button>
              <button
                className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                title="New Folder"
                onClick={() => {
                  setNewItemParentPath("");
                  setNewItemName("");
                  setIsNewFolderDialogOpen(true);
                }}
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* New file / folder inline dialog */}
          {(isNewFileDialogOpen || isNewFolderDialogOpen) && (
            <div className="px-2 py-1.5 border-b border-white/10 bg-gray-800/80">
              <div className="text-[10px] text-white/40 mb-1 uppercase tracking-wider">
                {isNewFileDialogOpen ? "New File" : "New Folder"}
                {newItemParentPath ? ` in ${newItemParentPath}/` : " at root"}
              </div>
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  isNewFileDialogOpen ? submitNewFile() : submitNewFolder();
                }}
              >
                <input
                  ref={newItemInputRef}
                  className="flex-1 bg-gray-900 border border-white/20 rounded px-1.5 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder={isNewFileDialogOpen ? "filename.ts" : "folder-name"}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setIsNewFileDialogOpen(false);
                      setIsNewFolderDialogOpen(false);
                      setNewItemName("");
                    }
                  }}
                />
                <button
                  type="submit"
                  className="text-xs px-1.5 py-0.5 rounded bg-purple-600 hover:bg-purple-500 text-white transition-colors"
                >
                  OK
                </button>
              </form>
            </div>
          )}

          {/* File tree */}
          <div className="flex-1 overflow-y-auto py-1 scrollbar-thin scrollbar-thumb-white/10">
            {tree.children.map((child) => (
              <TreeNode
                key={isCodeFile(child) ? child.id : `folder-${child.path}`}
                node={child}
                depth={0}
                activeFileId={activeId}
                onSelectFile={selectFile}
                onToggleFolder={toggleFolder}
                onContextMenu={handleContextMenu}
              />
            ))}
            {tree.children.length === 0 && (
              <div className="px-3 py-4 text-xs text-white/30 text-center">No files</div>
            )}
          </div>
        </div>

        {/* Resize handle */}
        <div
          className="w-[3px] cursor-col-resize bg-transparent hover:bg-purple-500/40 active:bg-purple-500/60 transition-colors shrink-0"
          onMouseDown={onResizeMouseDown}
        />

        {/* Editor pane */}
        <div className="flex-1 min-w-0 bg-gray-800">
          {activeFile ? (
            <Editor
              theme={editorTheme}
              language={editorLanguage}
              value={activeFile.content}
              onChange={handleEditorChange}
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Monaco, monospace",
                minimap: { enabled: true },
                wordWrap: "off",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                padding: { top: 8, bottom: 8 },
                lineNumbers: "on",
                renderLineHighlight: "line",
                cursorBlinking: "smooth",
                smoothScrolling: true,
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: true, indentation: true },
                tabSize: 2,
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-white/20 text-sm">
              <div className="text-center">
                <Code className="w-10 h-10 mx-auto mb-3 text-white/10" />
                <p>Select a file to open</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CodeEditorPanel;
