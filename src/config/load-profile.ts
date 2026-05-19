import type {
  AgentDefaultsConfig,
  AgentRuntimeLoadProfileConfig,
  RuntimeLoadProfileId,
} from "./types.agent-defaults.js";
import type { ArgentConfig } from "./types.argent.js";

export type RuntimeLoadProfilePreset = {
  id: RuntimeLoadProfileId;
  label: string;
  description: string;
  pollingMultiplier: number;
  patch: Partial<AgentDefaultsConfig>;
};

export const RUNTIME_LOAD_PROFILE_PRESETS: Record<RuntimeLoadProfileId, RuntimeLoadProfilePreset> =
  {
    desktop: {
      id: "desktop",
      label: "Desktop",
      description: "Full runtime behavior for desktops and larger always-on machines.",
      pollingMultiplier: 1,
      patch: {
        backgroundConcurrency: 2,
      },
    },
    "balanced-laptop": {
      id: "balanced-laptop",
      label: "Balanced Laptop",
      description:
        "Keep interactive work responsive while slowing background loops and UI polling.",
      pollingMultiplier: 2,
      patch: {
        heartbeat: { enabled: true, every: "45m" },
        contemplation: { enabled: true, every: "2h", maxCyclesPerHour: 1 },
        sis: { enabled: true, every: "2h", episodesPerConsolidation: 3 },
        executionWorker: {
          enabled: true,
          every: "1h",
          maxRunMinutes: 6,
          maxTasksPerCycle: 4,
          scope: "assigned",
          requireEvidence: true,
          maxNoProgressAttempts: 2,
        },
        maxConcurrent: 2,
        backgroundConcurrency: 1,
        subagents: { maxConcurrent: 1 },
      },
    },
    "cool-laptop": {
      id: "cool-laptop",
      label: "Cool Laptop",
      description: "Prioritize thermals and battery life; keep background behavior sparse.",
      pollingMultiplier: 4,
      patch: {
        heartbeat: { enabled: true, every: "1h" },
        contemplation: { enabled: true, every: "3h", maxCyclesPerHour: 1 },
        sis: { enabled: true, every: "3h", episodesPerConsolidation: 3 },
        executionWorker: {
          enabled: true,
          every: "90m",
          maxRunMinutes: 4,
          maxTasksPerCycle: 2,
          scope: "assigned",
          requireEvidence: true,
          maxNoProgressAttempts: 2,
        },
        maxConcurrent: 1,
        backgroundConcurrency: 1,
        subagents: { maxConcurrent: 1 },
      },
    },
  };

export type ResolvedRuntimeLoadProfile = RuntimeLoadProfilePreset & {
  allowManualOverrides: boolean;
};

function mergeDefined<T extends Record<string, unknown>>(base: T, patch?: Partial<T>): T {
  if (!patch) return base;
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

function mergeDefaults(
  defaults: AgentDefaultsConfig,
  patch: Partial<AgentDefaultsConfig>,
): AgentDefaultsConfig {
  const next: AgentDefaultsConfig = { ...defaults };
  if (patch.heartbeat) {
    next.heartbeat = mergeDefined(next.heartbeat ?? {}, patch.heartbeat);
  }
  if (patch.contemplation) {
    next.contemplation = mergeDefined(next.contemplation ?? {}, patch.contemplation);
  }
  if (patch.sis) {
    next.sis = mergeDefined(next.sis ?? {}, patch.sis);
  }
  if (patch.executionWorker) {
    next.executionWorker = mergeDefined(next.executionWorker ?? {}, patch.executionWorker);
  }
  if (patch.subagents) {
    next.subagents = mergeDefined(next.subagents ?? {}, patch.subagents);
  }
  if (typeof patch.maxConcurrent === "number") {
    next.maxConcurrent = patch.maxConcurrent;
  }
  if (typeof patch.backgroundConcurrency === "number") {
    next.backgroundConcurrency = patch.backgroundConcurrency;
  }
  return next;
}

export function resolveRuntimeLoadProfile(
  value?: AgentRuntimeLoadProfileConfig | null,
): ResolvedRuntimeLoadProfile {
  const active = value?.active ?? "desktop";
  const preset = RUNTIME_LOAD_PROFILE_PRESETS[active] ?? RUNTIME_LOAD_PROFILE_PRESETS.desktop;
  return {
    ...preset,
    allowManualOverrides: value?.allowManualOverrides !== false,
  };
}

export function applyRuntimeLoadProfile(cfg: ArgentConfig): ArgentConfig {
  const defaults = cfg.agents?.defaults;
  const loadProfile = defaults?.loadProfile;
  if (!defaults || !loadProfile || loadProfile.active === "desktop" || !loadProfile.active) {
    return cfg;
  }

  const resolved = resolveRuntimeLoadProfile(loadProfile);
  let nextDefaults = mergeDefaults(defaults, resolved.patch);
  if (resolved.allowManualOverrides && loadProfile.overrides) {
    const overridePatch: Partial<AgentDefaultsConfig> = {};
    if (loadProfile.overrides.heartbeat) {
      overridePatch.heartbeat = loadProfile.overrides.heartbeat;
    }
    if (loadProfile.overrides.contemplation) {
      overridePatch.contemplation = loadProfile.overrides.contemplation;
    }
    if (loadProfile.overrides.sis) {
      overridePatch.sis = loadProfile.overrides.sis;
    }
    if (loadProfile.overrides.executionWorker) {
      overridePatch.executionWorker = loadProfile.overrides.executionWorker;
    }
    if (typeof loadProfile.overrides.maxConcurrent === "number") {
      overridePatch.maxConcurrent = loadProfile.overrides.maxConcurrent;
    }
    if (typeof loadProfile.overrides.backgroundConcurrency === "number") {
      overridePatch.backgroundConcurrency = loadProfile.overrides.backgroundConcurrency;
    }
    if (loadProfile.overrides.subagents) {
      overridePatch.subagents = loadProfile.overrides.subagents;
    }
    nextDefaults = mergeDefaults(nextDefaults, overridePatch);
  }

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: nextDefaults,
    },
  };
}
