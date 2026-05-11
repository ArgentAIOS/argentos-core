export type RustGatewayShadowObservationSurface =
  | "workflow"
  | "session"
  | "run"
  | "timer"
  | "channel";

export type RustGatewayShadowObservationRole = "node-live" | "rust-shadow";

export type RustGatewayShadowObservationAction =
  | "observe"
  | "execute"
  | "schedule"
  | "send"
  | "own-session";

export type RustGatewayShadowObservation = {
  surface: RustGatewayShadowObservationSurface;
  id: string;
  role: RustGatewayShadowObservationRole;
  action: RustGatewayShadowObservationAction;
  observedAtMs: number;
};

export type RustGatewayShadowDuplicateConflict = {
  key: string;
  surface: RustGatewayShadowObservationSurface;
  id: string;
  reason:
    | "duplicate-live-authority"
    | "rust-non-observation-action"
    | "duplicate-rust-shadow-observation";
  roles: RustGatewayShadowObservationRole[];
  actions: RustGatewayShadowObservationAction[];
  count: number;
};

export type RustGatewayShadowDuplicateProof = {
  mode: "shadow-observation-only";
  status: "passed" | "blocked";
  requiredSurfaces: RustGatewayShadowObservationSurface[];
  coveredSurfaces: RustGatewayShadowObservationSurface[];
  missingSurfaces: RustGatewayShadowObservationSurface[];
  mirrorKeys: string[];
  conflicts: RustGatewayShadowDuplicateConflict[];
  policy: {
    nodeRemainsLiveAuthority: true;
    rustMayOnlyObserve: true;
    duplicateLiveAuthorityBlocksPromotion: true;
    duplicateRustShadowObservationBlocksPromotion: true;
  };
};

const REQUIRED_DUPLICATE_PROOF_SURFACES: RustGatewayShadowObservationSurface[] = [
  "workflow",
  "session",
  "run",
  "timer",
  "channel",
];

export const RUST_GATEWAY_SHADOW_DUPLICATE_PROOF_FIXTURE: RustGatewayShadowObservation[] = [
  shadowMirror("workflow", "wf-ready"),
  shadowMirror("session", "session-main"),
  shadowMirror("run", "run-ready"),
  shadowMirror("timer", "timer-daily"),
  shadowMirror("channel", "channel-slack"),
].flat();

export function analyzeRustGatewayShadowDuplicateObservations(
  observations: RustGatewayShadowObservation[],
  requiredSurfaces: RustGatewayShadowObservationSurface[] = REQUIRED_DUPLICATE_PROOF_SURFACES,
): RustGatewayShadowDuplicateProof {
  const conflicts: RustGatewayShadowDuplicateConflict[] = [];
  const mirrorKeys: string[] = [];
  const byKey = new Map<string, RustGatewayShadowObservation[]>();

  for (const observation of observations) {
    const key = observationKey(observation);
    const group = byKey.get(key) ?? [];
    group.push(observation);
    byKey.set(key, group);
  }

  for (const [key, group] of byKey) {
    const liveCount = group.filter((observation) => observation.role === "node-live").length;
    const rustShadow = group.filter((observation) => observation.role === "rust-shadow");
    const rustNonObserve = rustShadow.filter((observation) => observation.action !== "observe");
    const [first] = group;
    if (!first) {
      continue;
    }

    if (liveCount > 1) {
      conflicts.push(buildConflict(key, first, group, "duplicate-live-authority"));
    }
    if (rustNonObserve.length > 0) {
      conflicts.push(buildConflict(key, first, rustNonObserve, "rust-non-observation-action"));
    }
    if (rustShadow.length > 1) {
      conflicts.push(buildConflict(key, first, rustShadow, "duplicate-rust-shadow-observation"));
    }
    if (liveCount === 1 && rustShadow.length === 1 && rustNonObserve.length === 0) {
      mirrorKeys.push(key);
    }
  }

  const coveredSurfaces = uniqueSortedSurfaces(
    observations
      .filter(
        (observation) => observation.role === "rust-shadow" && observation.action === "observe",
      )
      .map((observation) => observation.surface),
  );
  const missingSurfaces = requiredSurfaces.filter((surface) => !coveredSurfaces.includes(surface));

  return {
    mode: "shadow-observation-only",
    status: conflicts.length === 0 && missingSurfaces.length === 0 ? "passed" : "blocked",
    requiredSurfaces: [...requiredSurfaces],
    coveredSurfaces,
    missingSurfaces,
    mirrorKeys: uniqueSortedStrings(mirrorKeys),
    conflicts,
    policy: {
      nodeRemainsLiveAuthority: true,
      rustMayOnlyObserve: true,
      duplicateLiveAuthorityBlocksPromotion: true,
      duplicateRustShadowObservationBlocksPromotion: true,
    },
  };
}

function shadowMirror(
  surface: RustGatewayShadowObservationSurface,
  id: string,
): RustGatewayShadowObservation[] {
  return [
    { surface, id, role: "node-live", action: liveActionForSurface(surface), observedAtMs: 1 },
    { surface, id, role: "rust-shadow", action: "observe", observedAtMs: 2 },
  ];
}

function liveActionForSurface(
  surface: RustGatewayShadowObservationSurface,
): RustGatewayShadowObservationAction {
  if (surface === "workflow" || surface === "run") {
    return "execute";
  }
  if (surface === "timer") {
    return "schedule";
  }
  if (surface === "channel") {
    return "send";
  }
  return "own-session";
}

function observationKey(observation: RustGatewayShadowObservation): string {
  return `${observation.surface}:${observation.id}`;
}

function buildConflict(
  key: string,
  first: RustGatewayShadowObservation,
  observations: RustGatewayShadowObservation[],
  reason: RustGatewayShadowDuplicateConflict["reason"],
): RustGatewayShadowDuplicateConflict {
  return {
    key,
    surface: first.surface,
    id: first.id,
    reason,
    roles: uniqueSortedStrings(observations.map((observation) => observation.role)),
    actions: uniqueSortedStrings(observations.map((observation) => observation.action)),
    count: observations.length,
  };
}

function uniqueSortedSurfaces(
  values: RustGatewayShadowObservationSurface[],
): RustGatewayShadowObservationSurface[] {
  return uniqueSortedStrings(values) as RustGatewayShadowObservationSurface[];
}

function uniqueSortedStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
}
