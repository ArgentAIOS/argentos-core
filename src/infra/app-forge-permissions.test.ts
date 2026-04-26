import { describe, expect, it } from "vitest";
import {
  buildAppForgePermissionChangeAuditEvent,
  buildAppForgePermissionCheckAuditEvent,
  canAdminAppForge,
  canReadAppForge,
  canWriteAppForge,
  createAppForgePermissions,
  createDefaultAppForgePermissions,
  normalizeAppForgeActor,
  resolveAppForgeAclRole,
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
