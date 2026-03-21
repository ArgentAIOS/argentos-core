import { CheckCircle, Plus, RefreshCw, Trash2, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ConnectorRootEntry = {
  path: string;
  label: string;
  exists: boolean;
  writable: boolean;
  kind: string;
};

type ConnectorRootsResponse = {
  ok?: boolean;
  roots?: ConnectorRootEntry[];
  suggestedRoot?: string | null;
  error?: string;
  details?: string;
};

type ConnectorActionDraft = {
  resource: string;
  action: string;
  requiredMode: "readonly" | "write" | "full" | "admin";
  summary: string;
};

type ScaffoldConnectorResponse = {
  ok?: boolean;
  tool?: string;
  targetDir?: string;
  rootDir?: string;
  files?: string[];
  nextSteps?: string[];
  error?: string;
  details?: string;
};

type ConnectorBuilderPanelProps = {
  disabled?: boolean;
  onBuilt?: (result: ScaffoldConnectorResponse) => void;
};

const CATEGORY_OPTIONS = [
  "general",
  "inbox",
  "ticket-queue",
  "table",
  "accounting",
  "alert-stream",
  "files-docs",
  "calendar",
  "crm",
  "social-publishing",
] as const;

const DEFAULT_ACTION: ConnectorActionDraft = {
  resource: "",
  action: "",
  requiredMode: "readonly",
  summary: "",
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function multilineToList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export function ConnectorBuilderPanel(props: ConnectorBuilderPanelProps) {
  const { disabled = false, onBuilt } = props;
  const [loadingRoots, setLoadingRoots] = useState(false);
  const [roots, setRoots] = useState<ConnectorRootEntry[]>([]);
  const [rootDir, setRootDir] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [result, setResult] = useState<ScaffoldConnectorResponse | null>(null);
  const [systemName, setSystemName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORY_OPTIONS)[number]>("general");
  const [backend, setBackend] = useState("");
  const [authKind, setAuthKind] = useState("none");
  const [serviceKeys, setServiceKeys] = useState("");
  const [interactiveSetup, setInteractiveSetup] = useState("");
  const [resources, setResources] = useState("");
  const [actions, setActions] = useState<ConnectorActionDraft[]>([{ ...DEFAULT_ACTION }]);

  const loadRoots = useCallback(async () => {
    try {
      setLoadingRoots(true);
      const response = await fetch("/api/settings/connectors/roots");
      const payload = (await response.json().catch(() => ({}))) as ConnectorRootsResponse;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || payload.details || `HTTP ${response.status}`);
      }
      const nextRoots = Array.isArray(payload.roots) ? payload.roots : [];
      setRoots(nextRoots);
      setRootDir(
        (current) =>
          current ||
          (typeof payload.suggestedRoot === "string"
            ? payload.suggestedRoot
            : nextRoots[0]?.path || ""),
      );
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load connector roots.",
      });
    } finally {
      setLoadingRoots(false);
    }
  }, []);

  useEffect(() => {
    if (disabled) return;
    void loadRoots();
  }, [disabled, loadRoots]);

  const suggestedSlug = useMemo(() => slugify(systemName), [systemName]);
  const effectiveSlug = slug.trim() || suggestedSlug;
  const canSubmit =
    !disabled &&
    !!systemName.trim() &&
    !!rootDir.trim() &&
    actions.some((entry) => entry.resource.trim() && entry.action.trim());

  const updateAction = (index: number, patch: Partial<ConnectorActionDraft>) => {
    setActions((current) =>
      current.map((entry, idx) => (idx === index ? { ...entry, ...patch } : entry)),
    );
  };

  const submit = useCallback(async () => {
    try {
      setSaving(true);
      setMessage(null);
      setResult(null);
      const response = await fetch("/api/settings/connectors/scaffold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootDir,
          systemName,
          slug: effectiveSlug,
          description,
          category,
          backend,
          authKind,
          serviceKeys: multilineToList(serviceKeys),
          interactiveSetup: multilineToList(interactiveSetup),
          resources: multilineToList(resources),
          actions: actions.filter((entry) => entry.resource.trim() && entry.action.trim()),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ScaffoldConnectorResponse;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.details || payload.error || `HTTP ${response.status}`);
      }
      setResult(payload);
      setMessage({
        type: "success",
        text: `${payload.tool || "Connector"} scaffolded successfully.`,
      });
      onBuilt?.(payload);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to scaffold connector.",
      });
    } finally {
      setSaving(false);
    }
  }, [
    actions,
    authKind,
    backend,
    category,
    description,
    effectiveSlug,
    interactiveSetup,
    onBuilt,
    resources,
    rootDir,
    serviceKeys,
    systemName,
  ]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-white/90 font-medium">Build Connector</div>
          <div className="text-white/50 text-xs max-w-xl">
            Scaffold a new <code className="text-cyan-300">aos-*</code> connector from inside
            ArgentOS. This creates the repo, harness, planned commands, and metadata so it shows up
            in the registry immediately.
          </div>
        </div>
        <button
          onClick={() => void loadRoots()}
          disabled={disabled || loadingRoots}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-xs text-white/80 hover:bg-gray-900/60 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingRoots ? "animate-spin" : ""}`} />
          {loadingRoots ? "Loading roots..." : "Reload roots"}
        </button>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            message.type === "success"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/20 bg-red-500/10 text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {disabled && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Build Connector is disabled in Public Core. Use the full operator surface to scaffold new
          system integrations.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-white/60 text-xs uppercase tracking-wide">System Name</label>
          <input
            value={systemName}
            onChange={(event) => setSystemName(event.target.value)}
            placeholder="QuickBooks"
            disabled={disabled}
            className="w-full mt-1 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-white/60 text-xs uppercase tracking-wide">Tool Slug</label>
          <input
            value={slug}
            onChange={(event) => setSlug(slugify(event.target.value))}
            placeholder={suggestedSlug || "quickbooks"}
            disabled={disabled}
            className="w-full mt-1 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
          />
          <div className="mt-1 text-[11px] text-white/35">
            Tool name will be{" "}
            <code className="text-cyan-300">aos-{effectiveSlug || "service"}</code>
          </div>
        </div>
        <div>
          <label className="text-white/60 text-xs uppercase tracking-wide">Category</label>
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as (typeof CATEGORY_OPTIONS)[number])
            }
            disabled={disabled}
            className="w-full mt-1 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-white/60 text-xs uppercase tracking-wide">Target Root</label>
          <select
            value={rootDir}
            onChange={(event) => setRootDir(event.target.value)}
            disabled={disabled || roots.length === 0}
            className="w-full mt-1 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
          >
            <option value="">Select connector root</option>
            {roots.map((root) => (
              <option key={root.path} value={root.path}>
                {root.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-white/60 text-xs uppercase tracking-wide">Description</label>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Agent-native QuickBooks connector"
            disabled={disabled}
            className="w-full mt-1 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-white/60 text-xs uppercase tracking-wide">Backend Hint</label>
          <input
            value={backend}
            onChange={(event) => setBackend(event.target.value)}
            placeholder="quickbooks-api"
            disabled={disabled}
            className="w-full mt-1 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-white/60 text-xs uppercase tracking-wide">Auth Kind</label>
          <select
            value={authKind}
            onChange={(event) => setAuthKind(event.target.value)}
            disabled={disabled}
            className="w-full mt-1 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
          >
            <option value="none">none</option>
            <option value="oauth">oauth</option>
            <option value="service-key">service-key</option>
            <option value="api-key">api-key</option>
            <option value="interactive">interactive</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-white/60 text-xs uppercase tracking-wide">Resources</label>
          <input
            value={resources}
            onChange={(event) => setResources(event.target.value)}
            placeholder="invoice, customer, ledger"
            disabled={disabled}
            className="w-full mt-1 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-white/60 text-xs uppercase tracking-wide">Service Keys</label>
          <textarea
            value={serviceKeys}
            onChange={(event) => setServiceKeys(event.target.value)}
            rows={4}
            placeholder={"QB_CLIENT_ID\nQB_CLIENT_SECRET"}
            disabled={disabled}
            className="w-full mt-1 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-white/60 text-xs uppercase tracking-wide">Interactive Setup</label>
          <textarea
            value={interactiveSetup}
            onChange={(event) => setInteractiveSetup(event.target.value)}
            rows={4}
            placeholder={"Complete OAuth login\nSelect target workspace"}
            disabled={disabled}
            className="w-full mt-1 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-white/85 font-medium">Planned Commands</div>
            <div className="text-white/45 text-xs">
              Define the first callable actions. These become scaffolded command IDs like{" "}
              <code className="text-cyan-300">invoice.list</code>.
            </div>
          </div>
          <button
            onClick={() => setActions((current) => [...current, { ...DEFAULT_ACTION }])}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-xs text-white/80 hover:bg-gray-900/60 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Add action
          </button>
        </div>

        <div className="space-y-2">
          {actions.map((entry, index) => (
            <div
              key={`action-${index}`}
              className="grid grid-cols-1 md:grid-cols-[1fr_1fr_140px_1.4fr_auto] gap-2"
            >
              <input
                value={entry.resource}
                onChange={(event) => updateAction(index, { resource: slugify(event.target.value) })}
                placeholder="invoice"
                disabled={disabled}
                className="rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
              />
              <input
                value={entry.action}
                onChange={(event) => updateAction(index, { action: slugify(event.target.value) })}
                placeholder="list"
                disabled={disabled}
                className="rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
              />
              <select
                value={entry.requiredMode}
                onChange={(event) =>
                  updateAction(index, {
                    requiredMode: event.target.value as ConnectorActionDraft["requiredMode"],
                  })
                }
                disabled={disabled}
                className="rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
              >
                <option value="readonly">readonly</option>
                <option value="write">write</option>
                <option value="full">full</option>
                <option value="admin">admin</option>
              </select>
              <input
                value={entry.summary}
                onChange={(event) => updateAction(index, { summary: event.target.value })}
                placeholder="List invoices"
                disabled={disabled}
                className="rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
              />
              <button
                onClick={() =>
                  setActions((current) =>
                    current.length === 1 ? current : current.filter((_, idx) => idx !== index),
                  )
                }
                disabled={disabled || actions.length === 1}
                className="inline-flex items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-red-200 hover:bg-red-500/15 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end">
        <button
          onClick={() => void submit()}
          disabled={!canSubmit || saving}
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-50"
        >
          <Wrench className="w-4 h-4" />
          {saving ? "Scaffolding..." : "Scaffold connector"}
        </button>
      </div>

      {result && (
        <div className="rounded-lg border border-white/10 bg-black/10 p-3 space-y-2 text-xs text-white/70">
          <div className="flex items-center gap-2 text-emerald-300">
            <CheckCircle className="w-4 h-4" />
            <span>{result.tool} created</span>
          </div>
          <div>
            Path: <code className="text-cyan-300">{result.targetDir}</code>
          </div>
          {Array.isArray(result.files) && result.files.length > 0 && (
            <div>
              <div className="text-white/45 uppercase tracking-wide text-[10px] mb-1">Files</div>
              <div className="space-y-1">
                {result.files.map((file) => (
                  <div key={file}>{file}</div>
                ))}
              </div>
            </div>
          )}
          {Array.isArray(result.nextSteps) && result.nextSteps.length > 0 && (
            <div>
              <div className="text-white/45 uppercase tracking-wide text-[10px] mb-1">
                Next steps
              </div>
              <div className="space-y-1">
                {result.nextSteps.map((step) => (
                  <div key={step}>{step}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
