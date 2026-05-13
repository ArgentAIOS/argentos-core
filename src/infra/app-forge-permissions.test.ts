import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppForgeAclDeniedError,
  APP_FORGE_NO_ACL_SCOPE_REASON,
  assertAppForgeAclWrite,
  buildAppForgePermissionChangeAuditEvent,
  buildAppForgePermissionCheckAuditEvent,
  canAdminAppForge,
  canReadAppForge,
  canWriteAppForge,
  coerceAppForgePermissionScope,
  createAppForgePermissions,
  createDefaultAppForgePermissions,
  emitAppForgeAuditEvent,
  normalizeAppForgeActor,
  resetAppForgeAuditLogger,
  resolveAppForgeAclRole,
  setAppForgeAuditLogger,
  type AppForgePermissionCheckAuditEvent,
} from "./app-forge-permissions.js";

describe("AppForge permissions seam", () => {
  it("defaults to a creator-owned ACL", () => {
    const permissions = createDefaultAppForgePermissions(
      {
        actorId: "creator-1",
        actorType: "operator",
        actorRole: "builder",
      },
      { createdAt: "2026-04-26T12:00:00.000Z" },
    );

    expect(permissions).toEqual({
      version: 1,
      createdAt: "2026-04-26T12:00:00.000Z",
      updatedAt: "2026-04-26T12:00:00.000Z",
      createdBy: {
        actorId: "creator-1",
        actorType: "operator",
        actorRole: "builder",
        actorTeam: undefined,
        sessionKey: undefined,
      },
      owners: [
        {
          actorId: "creator-1",
          actorType: "operator",
          actorRole: "builder",
          actorTeam: undefined,
          sessionKey: undefined,
          addedAt: "2026-04-26T12:00:00.000Z",
          addedBy: { actorId: "creator-1", actorType: "operator" },
        },
      ],
      editors: [],
      viewers: [],
    });
  });

  it("dedupes ACL subjects and keeps the highest access level", () => {
    const permissions = createAppForgePermissions({
      creator: "Creator-1",
      owners: ["owner-2", "creator-1"],
      editors: ["OWNER-2", "editor-1", "viewer-1"],
      viewers: ["editor-1", "viewer-1", "viewer-2"],
      createdAt: "2026-04-26T13:00:00.000Z",
      updatedAt: "2026-04-26T14:00:00.000Z",
    });

    expect(permissions.owners.map((entry) => entry.actorId)).toEqual(["Creator-1", "owner-2"]);
    expect(permissions.editors.map((entry) => entry.actorId)).toEqual(["editor-1", "viewer-1"]);
    expect(permissions.viewers.map((entry) => entry.actorId)).toEqual(["viewer-2"]);
  });

  it("resolves read, write, and admin access by ACL role", () => {
    const permissions = createAppForgePermissions({
      creator: { actorId: "owner-1", actorType: "operator" },
      editors: [{ actorId: "editor-1", actorType: "system" }],
      viewers: ["viewer-1"],
      createdAt: "2026-04-26T15:00:00.000Z",
    });

    expect(resolveAppForgeAclRole(permissions, "owner-1")).toBe("owner");
    expect(resolveAppForgeAclRole(permissions, { actorId: "EDITOR-1" })).toBe("editor");
    expect(resolveAppForgeAclRole(permissions, "viewer-1")).toBe("viewer");
    expect(resolveAppForgeAclRole(permissions, "missing")).toBeNull();

    expect(canReadAppForge(permissions, "viewer-1")).toBe(true);
    expect(canWriteAppForge(permissions, "viewer-1")).toBe(false);
    expect(canAdminAppForge(permissions, "viewer-1")).toBe(false);

    expect(canReadAppForge(permissions, "editor-1")).toBe(true);
    expect(canWriteAppForge(permissions, "editor-1")).toBe(true);
    expect(canAdminAppForge(permissions, "editor-1")).toBe(false);

    expect(canReadAppForge(permissions, "owner-1")).toBe(true);
    expect(canWriteAppForge(permissions, "owner-1")).toBe(true);
    expect(canAdminAppForge(permissions, "owner-1")).toBe(true);
  });

  it("coerces raw ACL claims into a normalized permission scope", () => {
    const scope = coerceAppForgePermissionScope({
      owners: [{ actorId: "owner-1", actorType: "operator", addedAt: "ignored" }],
      editors: ["owner-1", { actorId: "editor-1", actorType: "system" }],
      viewers: ["editor-1", "viewer-1", "viewer-1"],
    });

    expect(scope).toMatchObject({
      owners: [{ actorId: "owner-1", actorType: "operator" }],
      editors: [{ actorId: "editor-1", actorType: "system" }],
      viewers: [{ actorId: "viewer-1" }],
    });
    expect(scope?.owners[0]?.addedAt).toEqual(expect.any(String));
    expect(coerceAppForgePermissionScope({ owners: ["owner-1"], editors: "nope" })).toBeNull();
    expect(coerceAppForgePermissionScope(null)).toBeNull();
  });

  it("builds permission audit events with computed role and ACL snapshot", () => {
    const permissions = createAppForgePermissions({
      creator: "owner-1",
      editors: ["editor-1"],
      viewers: ["viewer-1"],
      createdAt: "2026-04-26T16:00:00.000Z",
    });

    const checkEvent = buildAppForgePermissionCheckAuditEvent({
      appId: "app-1",
      actor: { actorId: "editor-1", actorType: "operator", sessionKey: "agent:editor-1:main" },
      permissions,
      permission: "write",
      emittedAt: "2026-04-26T16:05:00.000Z",
    });

    expect(checkEvent).toEqual({
      eventType: "forge.permissions.checked",
      source: "appforge",
      appId: "app-1",
      permission: "write",
      allowed: true,
      actor: {
        actorId: "editor-1",
        actorType: "operator",
        actorRole: undefined,
        actorTeam: undefined,
        sessionKey: "agent:editor-1:main",
      },
      aclRole: "editor",
      reason: undefined,
      emittedAt: "2026-04-26T16:05:00.000Z",
      acl: {
        owners: ["owner-1"],
        editors: ["editor-1"],
        viewers: ["viewer-1"],
      },
    });

    const changeEvent = buildAppForgePermissionChangeAuditEvent({
      appId: "app-1",
      actor: normalizeAppForgeActor({ actorId: "owner-1", actorType: "operator" }),
      subject: "viewer-1",
      aclRole: "viewer",
      change: "revoke",
      permissions,
      emittedAt: "2026-04-26T16:06:00.000Z",
    });

    expect(changeEvent).toEqual({
      eventType: "forge.permissions.changed",
      source: "appforge",
      appId: "app-1",
      change: "revoke",
      aclRole: "viewer",
      actor: {
        actorId: "owner-1",
        actorType: "operator",
        actorRole: undefined,
        actorTeam: undefined,
        sessionKey: undefined,
      },
      subject: {
        actorId: "viewer-1",
        actorType: undefined,
        actorRole: undefined,
        actorTeam: undefined,
        sessionKey: undefined,
      },
      emittedAt: "2026-04-26T16:06:00.000Z",
      acl: {
        owners: ["owner-1"],
        editors: ["editor-1"],
        viewers: ["viewer-1"],
      },
    });
  });
});

describe("AppForge ACL write gate (#336)", () => {
  afterEach(() => {
    resetAppForgeAuditLogger();
  });

  it("allows actors with write access and emits an allow audit event", () => {
    const events: AppForgePermissionCheckAuditEvent[] = [];
    setAppForgeAuditLogger((event) => events.push(event));

    const scope = createAppForgePermissions({
      creator: "owner-1",
      editors: ["editor-1"],
      viewers: ["viewer-1"],
    });

    const audit = assertAppForgeAclWrite({
      appId: "app-1",
      actor: "editor-1",
      action: "record.put",
      scope,
      resourceId: "base/table/rec",
    });

    expect(audit.allowed).toBe(true);
    expect(audit.aclRole).toBe("editor");
    expect(audit.permission).toBe("write");
    expect(events).toHaveLength(1);
    expect(events[0]?.allowed).toBe(true);
    expect(events[0]?.reason).toContain("record.put");
  });

  it("throws AppForgeAclDeniedError when actor lacks write access and emits deny audit", () => {
    const events: AppForgePermissionCheckAuditEvent[] = [];
    setAppForgeAuditLogger((event) => events.push(event));

    const scope = createAppForgePermissions({
      creator: "owner-1",
      viewers: ["viewer-1"],
    });

    expect(() =>
      assertAppForgeAclWrite({
        appId: "app-1",
        actor: { actorId: "viewer-1", actorType: "operator" },
        action: "record.put",
        scope,
      }),
    ).toThrowError(AppForgeAclDeniedError);

    expect(events).toHaveLength(1);
    expect(events[0]?.allowed).toBe(false);
    expect(events[0]?.aclRole).toBe("viewer");
    expect(events[0]?.reason).toContain("actor lacks owner/editor");
  });

  it("attaches the audit event to AppForgeAclDeniedError", () => {
    setAppForgeAuditLogger(() => {});
    const scope = createAppForgePermissions({ creator: "owner-1", viewers: ["v-1"] });

    let caught: unknown;
    try {
      assertAppForgeAclWrite({
        appId: "app-acl",
        actor: "v-1",
        action: "base.delete",
        scope,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppForgeAclDeniedError);
    const err = caught as AppForgeAclDeniedError;
    expect(err.code).toBe("appforge_acl_denied");
    expect(err.audit.allowed).toBe(false);
    expect(err.audit.appId).toBe("app-acl");
  });

  it("legacy single-operator mode: no scope provided ⇒ allow + audit with explanatory reason", () => {
    const events: AppForgePermissionCheckAuditEvent[] = [];
    setAppForgeAuditLogger((event) => events.push(event));

    const audit = assertAppForgeAclWrite({
      appId: "app-legacy",
      actor: null,
      action: "table.put",
    });

    expect(audit.allowed).toBe(true);
    expect(audit.actor.actorId).toBe("system:unauthenticated");
    expect(audit.reason).toContain(APP_FORGE_NO_ACL_SCOPE_REASON);
    expect(events).toHaveLength(1);
  });

  it("setAppForgeAuditLogger swaps the active logger; resetAppForgeAuditLogger restores the default", () => {
    const stub = vi.fn();
    setAppForgeAuditLogger(stub);
    emitAppForgeAuditEvent({
      eventType: "forge.permissions.checked",
      source: "appforge",
      appId: "app-x",
      permission: "write",
      allowed: true,
      actor: { actorId: "a" },
      aclRole: null,
      emittedAt: "2026-04-26T00:00:00Z",
      acl: { owners: [], editors: [], viewers: [] },
    });
    expect(stub).toHaveBeenCalledTimes(1);

    resetAppForgeAuditLogger();
    // default logger only logs deny events; allow should be silent and not throw.
    expect(() =>
      emitAppForgeAuditEvent({
        eventType: "forge.permissions.checked",
        source: "appforge",
        appId: "app-x",
        permission: "write",
        allowed: true,
        actor: { actorId: "a" },
        aclRole: null,
        emittedAt: "2026-04-26T00:00:00Z",
        acl: { owners: [], editors: [], viewers: [] },
      }),
    ).not.toThrow();
  });

  it("audit logger errors do not propagate to callers", () => {
    setAppForgeAuditLogger(() => {
      throw new Error("logger blew up");
    });
    const scope = createAppForgePermissions({ creator: "owner-1" });

    expect(() =>
      assertAppForgeAclWrite({
        appId: "app-1",
        actor: "owner-1",
        action: "record.put",
        scope,
      }),
    ).not.toThrow();
  });
});
