export const APP_FORGE_ACTOR_TYPES = ["operator", "system"] as const;
export type AppForgeActorType = (typeof APP_FORGE_ACTOR_TYPES)[number];

export const APP_FORGE_ACL_ROLES = ["owner", "editor", "viewer"] as const;
export type AppForgeAclRole = (typeof APP_FORGE_ACL_ROLES)[number];

export const APP_FORGE_ACCESS_LEVELS = ["read", "write", "admin"] as const;
export type AppForgeAccessLevel = (typeof APP_FORGE_ACCESS_LEVELS)[number];

export const APP_FORGE_PERMISSION_AUDIT_EVENT_TYPES = [
  "forge.permissions.checked",
  "forge.permissions.changed",
] as const;
export type AppForgePermissionAuditEventType =
  (typeof APP_FORGE_PERMISSION_AUDIT_EVENT_TYPES)[number];

export type AppForgeActorEnvelope = {
  actorId: string;
  actorType?: AppForgeActorType;
  actorRole?: string;
  actorTeam?: string;
  sessionKey?: string;
};

export type AppForgeActorInput = string | AppForgeActorEnvelope;

export type AppForgeAclEntry = AppForgeActorEnvelope & {
  addedAt: string;
  addedBy?: Pick<AppForgeActorEnvelope, "actorId" | "actorType">;
};

export type AppForgePermissions = {
  version: 1;
  createdAt: string;
  updatedAt: string;
  createdBy: AppForgeActorEnvelope;
  owners: AppForgeAclEntry[];
  editors: AppForgeAclEntry[];
  viewers: AppForgeAclEntry[];
};

export type AppForgePermissionSnapshot = {
  owners: string[];
  editors: string[];
  viewers: string[];
};

export type AppForgePermissionScope = Pick<AppForgePermissions, "owners" | "editors" | "viewers">;

export type AppForgePermissionCheckAuditEvent = {
  eventType: "forge.permissions.checked";
  source: "appforge";
  appId: string;
  permission: AppForgeAccessLevel;
  allowed: boolean;
  actor: AppForgeActorEnvelope;
  aclRole: AppForgeAclRole | null;
  reason?: string;
  emittedAt: string;
  acl: AppForgePermissionSnapshot;
};

export type AppForgePermissionChangeAuditEvent = {
  eventType: "forge.permissions.changed";
  source: "appforge";
  appId: string;
  change: "initialize" | "grant" | "revoke";
  aclRole: AppForgeAclRole;
  actor: AppForgeActorEnvelope;
  subject: AppForgeActorEnvelope;
  emittedAt: string;
  acl: AppForgePermissionSnapshot;
};

function nowIso(): string {
  return new Date().toISOString();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeActorType(value: unknown): AppForgeActorType | undefined {
  return APP_FORGE_ACTOR_TYPES.includes(value as AppForgeActorType)
    ? (value as AppForgeActorType)
    : undefined;
}

function maybeNormalizeAppForgeActor(
  input: AppForgeActorInput | null | undefined,
): AppForgeActorEnvelope | null {
  if (typeof input === "string") {
    const actorId = stringValue(input);
    return actorId ? { actorId } : null;
  }
  if (!input || typeof input !== "object") {
    return null;
  }

  const actorId = stringValue(input.actorId);
  if (!actorId) {
    return null;
  }

  return {
    actorId,
    actorType: normalizeActorType(input.actorType),
    actorRole: stringValue(input.actorRole),
    actorTeam: stringValue(input.actorTeam),
    sessionKey: stringValue(input.sessionKey),
  };
}

function actorKey(actor: AppForgeActorEnvelope): string {
  return actor.actorId.trim().toLowerCase();
}

function uniqueAclEntries(
  inputs: AppForgeActorInput[] | undefined,
  addedAt: string,
  addedBy?: AppForgeActorInput,
): AppForgeAclEntry[] {
  const normalizedAddedBy = maybeNormalizeAppForgeActor(addedBy);
  const entries = new Map<string, AppForgeAclEntry>();

  for (const input of inputs ?? []) {
    const actor = maybeNormalizeAppForgeActor(input);
    if (!actor) {
      continue;
    }

    const key = actorKey(actor);
    if (entries.has(key)) {
      continue;
    }

    entries.set(key, {
      ...actor,
      addedAt,
      addedBy: normalizedAddedBy
        ? {
            actorId: normalizedAddedBy.actorId,
            actorType: normalizedAddedBy.actorType,
          }
        : undefined,
    });
  }

  return [...entries.values()];
}

function removeCoveredActors(
  entries: AppForgeAclEntry[],
  covered: Iterable<AppForgeAclEntry>,
): AppForgeAclEntry[] {
  const blocked = new Set([...covered].map(actorKey));
  return entries.filter((entry) => !blocked.has(actorKey(entry)));
}

export function normalizeAppForgeActor(input: AppForgeActorInput): AppForgeActorEnvelope {
  const actor = maybeNormalizeAppForgeActor(input);
  if (!actor) {
    throw new Error("actorId is required");
  }
  return actor;
}

export function createAppForgePermissions(params: {
  creator: AppForgeActorInput;
  owners?: AppForgeActorInput[];
  editors?: AppForgeActorInput[];
  viewers?: AppForgeActorInput[];
  createdAt?: string;
  updatedAt?: string;
}): AppForgePermissions {
  const createdBy = normalizeAppForgeActor(params.creator);
  const createdAt = stringValue(params.createdAt) ?? nowIso();
  const updatedAt = stringValue(params.updatedAt) ?? createdAt;
  const owners = uniqueAclEntries([createdBy, ...(params.owners ?? [])], createdAt, createdBy);
  const editors = removeCoveredActors(
    uniqueAclEntries(params.editors, createdAt, createdBy),
    owners,
  );
  const viewers = removeCoveredActors(uniqueAclEntries(params.viewers, createdAt, createdBy), [
    ...owners,
    ...editors,
  ]);

  return {
    version: 1,
    createdAt,
    updatedAt,
    createdBy,
    owners,
    editors,
    viewers,
  };
}

export function createDefaultAppForgePermissions(
  creator: AppForgeActorInput,
  opts?: { createdAt?: string; updatedAt?: string },
): AppForgePermissions {
  return createAppForgePermissions({
    creator,
    createdAt: opts?.createdAt,
    updatedAt: opts?.updatedAt,
  });
}

export function snapshotAppForgePermissions(
  permissions: Pick<AppForgePermissions, "owners" | "editors" | "viewers">,
): AppForgePermissionSnapshot {
  return {
    owners: permissions.owners.map((entry) => entry.actorId),
    editors: permissions.editors.map((entry) => entry.actorId),
    viewers: permissions.viewers.map((entry) => entry.actorId),
  };
}

function normalizeAclEntries(value: unknown, addedAt: string): AppForgeAclEntry[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const entries = new Map<string, AppForgeAclEntry>();
  for (const item of value) {
    const actor = maybeNormalizeAppForgeActor(item);
    if (!actor) {
      return null;
    }
    const key = actorKey(actor);
    if (entries.has(key)) {
      continue;
    }
    entries.set(key, { ...actor, addedAt });
  }
  return [...entries.values()];
}

export function coerceAppForgePermissionScope(value: unknown): AppForgePermissionScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const addedAt = nowIso();
  const owners = normalizeAclEntries(record.owners, addedAt);
  const editors = normalizeAclEntries(record.editors, addedAt);
  const viewers = normalizeAclEntries(record.viewers, addedAt);
  if (!owners || !editors || !viewers) {
    return null;
  }

  return {
    owners,
    editors: removeCoveredActors(editors, owners),
    viewers: removeCoveredActors(viewers, [...owners, ...editors]),
  };
}

export function resolveAppForgeAclRole(
  permissions: Pick<AppForgePermissions, "owners" | "editors" | "viewers">,
  actor: AppForgeActorInput | null | undefined,
): AppForgeAclRole | null {
  const normalizedActor = maybeNormalizeAppForgeActor(actor);
  if (!normalizedActor) {
    return null;
  }

  const key = actorKey(normalizedActor);
  if (permissions.owners.some((entry) => actorKey(entry) === key)) {
    return "owner";
  }
  if (permissions.editors.some((entry) => actorKey(entry) === key)) {
    return "editor";
  }
  if (permissions.viewers.some((entry) => actorKey(entry) === key)) {
    return "viewer";
  }
  return null;
}

export function hasAppForgePermission(
  permissions: Pick<AppForgePermissions, "owners" | "editors" | "viewers">,
  actor: AppForgeActorInput | null | undefined,
  access: AppForgeAccessLevel,
): boolean {
  const role = resolveAppForgeAclRole(permissions, actor);
  if (access === "admin") {
    return role === "owner";
  }
  if (access === "write") {
    return role === "owner" || role === "editor";
  }
  return role === "owner" || role === "editor" || role === "viewer";
}

export function canReadAppForge(
  permissions: Pick<AppForgePermissions, "owners" | "editors" | "viewers">,
  actor: AppForgeActorInput | null | undefined,
): boolean {
  return hasAppForgePermission(permissions, actor, "read");
}

export function canWriteAppForge(
  permissions: Pick<AppForgePermissions, "owners" | "editors" | "viewers">,
  actor: AppForgeActorInput | null | undefined,
): boolean {
  return hasAppForgePermission(permissions, actor, "write");
}

export function canAdminAppForge(
  permissions: Pick<AppForgePermissions, "owners" | "editors" | "viewers">,
  actor: AppForgeActorInput | null | undefined,
): boolean {
  return hasAppForgePermission(permissions, actor, "admin");
}

export function buildAppForgePermissionCheckAuditEvent(params: {
  appId: string;
  actor: AppForgeActorInput;
  permissions: Pick<AppForgePermissions, "owners" | "editors" | "viewers">;
  permission: AppForgeAccessLevel;
  allowed?: boolean;
  reason?: string;
  emittedAt?: string;
}): AppForgePermissionCheckAuditEvent {
  const actor = normalizeAppForgeActor(params.actor);
  const aclRole = resolveAppForgeAclRole(params.permissions, actor);
  return {
    eventType: "forge.permissions.checked",
    source: "appforge",
    appId: params.appId,
    permission: params.permission,
    allowed: params.allowed ?? hasAppForgePermission(params.permissions, actor, params.permission),
    actor,
    aclRole,
    reason: stringValue(params.reason),
    emittedAt: stringValue(params.emittedAt) ?? nowIso(),
    acl: snapshotAppForgePermissions(params.permissions),
  };
}

export function buildAppForgePermissionChangeAuditEvent(params: {
  appId: string;
  actor: AppForgeActorInput;
  subject: AppForgeActorInput;
  aclRole: AppForgeAclRole;
  change: "initialize" | "grant" | "revoke";
  permissions: Pick<AppForgePermissions, "owners" | "editors" | "viewers">;
  emittedAt?: string;
}): AppForgePermissionChangeAuditEvent {
  return {
    eventType: "forge.permissions.changed",
    source: "appforge",
    appId: params.appId,
    change: params.change,
    aclRole: params.aclRole,
    actor: normalizeAppForgeActor(params.actor),
    subject: normalizeAppForgeActor(params.subject),
    emittedAt: stringValue(params.emittedAt) ?? nowIso(),
    acl: snapshotAppForgePermissions(params.permissions),
  };
}
