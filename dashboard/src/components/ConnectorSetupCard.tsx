import { AlertTriangle, CheckCircle, KeyRound, Package, RefreshCw, Wrench } from "lucide-react";
import {
  buildFallbackConnectorSetup,
  type ConnectorSetupAction,
  type ConnectorSetupStatus,
} from "../lib/connectorSetup";

type ConnectorLike = {
  tool: string;
  label: string;
  installState: "ready" | "needs-setup" | "repo-only" | "error";
  status: {
    label: string;
    detail?: string;
  };
  discovery?: {
    binaryPath?: string;
    harnessDir?: string;
    repoDir?: string;
    requiresPython?: string;
  };
  auth?: {
    kind?: string;
    required?: boolean;
    serviceKeys?: string[];
    interactiveSetup?: string[];
  };
};

type ConnectorSetupCardProps = {
  connector: ConnectorLike;
  setupStatus?: ConnectorSetupStatus | null;
  loading?: boolean;
  launchingAction?: string | null;
  autoRefreshing?: boolean;
  disabled?: boolean;
  onCheck?: (installMissing: boolean) => void;
  onLaunch?: (action: string) => void;
  onOpenApiKeys?: () => void;
  onOpenSystems?: () => void;
  compact?: boolean;
};

function accentClasses(action: ConnectorSetupAction): string {
  switch (action.accent) {
    case "success":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15";
    case "secondary":
      return "border-white/10 bg-gray-900/40 text-white/80 hover:bg-gray-900/60";
    default:
      return "border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/15";
  }
}

function actionIcon(action: ConnectorSetupAction) {
  if (action.kind === "check") {
    return action.installMissing ? Package : Wrench;
  }
  if (action.id.includes("login") || action.id.includes("connect")) {
    return CheckCircle;
  }
  if (action.id.includes("folder") || action.id.includes("path")) {
    return Package;
  }
  return Wrench;
}

export function ConnectorSetupCard(props: ConnectorSetupCardProps) {
  const {
    connector,
    setupStatus,
    loading = false,
    launchingAction = null,
    autoRefreshing = false,
    disabled = false,
    onCheck,
    onLaunch,
    onOpenApiKeys,
    onOpenSystems,
    compact = false,
  } = props;

  const effective = setupStatus ?? buildFallbackConnectorSetup(connector);
  const hasActions = effective.actions.length > 0;
  const hasServiceKeys = (connector.auth?.serviceKeys?.length ?? 0) > 0;
  const showOperatorShortcuts = Boolean((onOpenApiKeys && hasServiceKeys) || onOpenSystems);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-3 space-y-3 text-xs text-white/70">
      <div className="flex items-center gap-2">
        {effective.ok ? (
          <CheckCircle className="w-4 h-4 text-emerald-400" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-400" />
        )}
        <span className="text-white/85 font-medium">{effective.title}</span>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/60 space-y-1">
        <div>{effective.summary}</div>
        {effective.detail ? <div>{effective.detail}</div> : null}
      </div>

      {autoRefreshing ? (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-100">
          Watching for connector setup changes now. Finish the browser or terminal flow, then this
          card will re-check automatically for up to two minutes.
        </div>
      ) : null}

      {hasActions ? (
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 space-y-2">
          <div className="text-white/80 font-medium">Guided setup</div>
          <div className="text-white/45">
            Use these actions in order. Each one opens the exact local path or terminal command
            needed.
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {effective.actions.map((action) => {
              const Icon = actionIcon(action);
              const busy =
                action.kind === "check"
                  ? loading && (!!action.installMissing || !effective.ok)
                  : launchingAction === action.id;
              return (
                <button
                  key={action.id}
                  onClick={() => {
                    if (action.kind === "check") {
                      onCheck?.(action.installMissing === true);
                    } else {
                      onLaunch?.(action.id);
                    }
                  }}
                  disabled={
                    disabled || (action.kind === "check" ? loading : launchingAction !== null)
                  }
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs disabled:opacity-50 ${accentClasses(action)}`}
                  title={action.detail || action.label}
                >
                  {busy ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                  {busy ? (action.kind === "check" ? "Checking..." : "Launching...") : action.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {showOperatorShortcuts ? (
        <div className="flex items-center gap-2 flex-wrap">
          {onOpenApiKeys && hasServiceKeys ? (
            <button
              onClick={onOpenApiKeys}
              disabled={disabled}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-xs text-white/80 hover:bg-gray-900/60 disabled:opacity-50"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Open API Keys
            </button>
          ) : null}
          {onOpenSystems ? (
            <button
              onClick={onOpenSystems}
              disabled={disabled}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900/40 px-3 py-2 text-xs text-white/80 hover:bg-gray-900/60 disabled:opacity-50"
            >
              <Wrench className="w-3.5 h-3.5" />
              Open Systems Setup
            </button>
          ) : null}
        </div>
      ) : null}

      {effective.checks.length > 0 ? (
        <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"}`}>
          {effective.checks.map((check) => (
            <div key={check.name} className="rounded border border-white/10 bg-white/5 px-2 py-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={
                    check.ok
                      ? "text-emerald-300"
                      : check.optional
                        ? "text-sky-200"
                        : "text-amber-200"
                  }
                >
                  {check.ok ? "PASS" : check.optional ? "OPTIONAL" : "WAIT"}
                </span>
                <span className="text-white/85">{check.label}</span>
                {check.optional ? (
                  <span className="rounded-full border border-white/10 bg-black/10 px-1.5 py-0.5 text-[10px] text-white/40">
                    advisory
                  </span>
                ) : null}
              </div>
              {check.summary ? <div className="mt-1 text-white/45">{check.summary}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {effective.nextSteps.length > 0 ? (
        <div className="space-y-1 text-[11px] text-white/45">
          {effective.nextSteps.map((step) => (
            <div key={step}>• {step}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
