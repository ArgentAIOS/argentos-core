import { Award, CheckCircle, KeyRound, RefreshCw, Shield, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:9242";

type LicenseStatus = {
  hasLicense: boolean;
  status?: string;
  tier?: string;
  expiresAt?: string;
  lastValidated?: string;
  orgName?: string;
  machineId?: string;
};

type LicenseMessage = {
  type: "success" | "error";
  text: string;
};

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function displayValue(value: unknown, fallback = "Not set"): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

export function LicensePanel() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [machineId, setMachineId] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<LicenseMessage | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const [statusPayload, machinePayload] = await Promise.all([
        readJson<LicenseStatus>(`${API_BASE}/api/license/status`),
        readJson<{ machineId?: string }>(`${API_BASE}/api/license/machine-id`).catch(
          (): { machineId?: string } => ({}),
        ),
      ]);
      setStatus(statusPayload);
      setMachineId(machinePayload.machineId || statusPayload.machineId || "");
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to load license status.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const activate = async () => {
    const key = licenseKey.trim();
    if (!key) {
      setMessage({ type: "error", text: "Enter a license key first." });
      return;
    }
    setActionLoading("activate");
    setMessage(null);
    try {
      await readJson(`${API_BASE}/api/license/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      setLicenseKey("");
      setMessage({ type: "success", text: "License activated." });
      await loadStatus();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "License activation failed.",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const validate = async () => {
    setActionLoading("validate");
    setMessage(null);
    try {
      await readJson(`${API_BASE}/api/license/validate`, { method: "POST" });
      setMessage({ type: "success", text: "License validated." });
      await loadStatus();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "License validation failed.",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const deactivate = async () => {
    setActionLoading("deactivate");
    setMessage(null);
    try {
      await readJson(`${API_BASE}/api/license/deactivate`, { method: "POST" });
      setMessage({ type: "success", text: "License removed." });
      await loadStatus();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "License deactivation failed.",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const active = status?.hasLicense && status.status === "active";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-white font-medium">Licensing</h4>
          <p className="text-white/50 text-sm">
            Activate a business license on top of Core or inspect the current license state.
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
            active
              ? "border-green-500/30 bg-green-500/10 text-green-300"
              : "border-white/10 bg-white/5 text-white/60"
          }`}
        >
          {active ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {active ? "Active" : "Inactive"}
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            message.type === "success"
              ? "border-green-500/30 bg-green-500/10 text-green-200"
              : "border-red-500/30 bg-red-500/10 text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-white/80">
            <Shield className="h-4 w-4 text-cyan-300" />
            <span className="text-sm font-medium">Current License</span>
          </div>
          {loading ? (
            <div className="text-sm text-white/50">Loading license status...</div>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-white/45">Status</span>
                <span className="text-white/80">{displayValue(status?.status, "inactive")}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-white/45">Tier</span>
                <span className="text-white/80">{displayValue(status?.tier)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-white/45">Organization</span>
                <span className="text-white/80">{displayValue(status?.orgName)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-white/45">Last validated</span>
                <span className="text-white/80">{displayValue(status?.lastValidated)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-white/80">
            <KeyRound className="h-4 w-4 text-purple-300" />
            <span className="text-sm font-medium">Activation</span>
          </div>
          <div className="space-y-3">
            <input
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              type="password"
              autoComplete="off"
              placeholder="aos_XXXX-XXXX-XXXX-XXXX"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-purple-400/50 focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={activate}
                disabled={actionLoading !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Award className="h-4 w-4" />
                {actionLoading === "activate" ? "Activating..." : "Activate"}
              </button>
              <button
                onClick={validate}
                disabled={actionLoading !== null || !status?.hasLicense}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" />
                {actionLoading === "validate" ? "Validating..." : "Validate"}
              </button>
              <button
                onClick={deactivate}
                disabled={actionLoading !== null || !status?.hasLicense}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading === "deactivate" ? "Removing..." : "Remove"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {machineId && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-white/35">Machine ID</div>
          <code className="break-all text-xs text-white/70">{machineId}</code>
        </div>
      )}
    </div>
  );
}
