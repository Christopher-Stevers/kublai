import { TRPCError } from "@trpc/server";

import {
  MANAGING_DEFAULTS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  STANDARD_DEFAULTS,
  isPermissionKey,
  type PermissionKey,
  type PermissionMap,
} from "~/lib/permission-catalog";

export type { PermissionKey, PermissionMap } from "~/lib/permission-catalog";

type PermissionUser = {
  role?: string | null;
  permissionConfig?: unknown;
  hasOneTimeAccess?: boolean | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
  subscriptionEndsAt?: Date | string | null;
};

export const appTabIds = [
  "dashboard",
  "catalogue",
  "suppliers",
  "quotes",
  "orders",
  "draws",
  "estimating",
  "assets",
  "timesheets",
  "organization",
] as const;

export type AppTabId = (typeof appTabIds)[number];

/** Pre-2026-10 stored shape; still read for members nobody has edited since. */
type LegacyPermissionConfig = {
  tabs?: Partial<Record<AppTabId, boolean>>;
  actions?: {
    canCreateParts?: boolean;
    canEditParts?: boolean;
    canDeleteParts?: boolean;
    canDelete?: boolean;
    canManageAssets?: boolean;
  };
};

export type StoredPermissionConfig = {
  version: 2;
  permissions: Partial<PermissionMap>;
};

function normalizedRole(user: PermissionUser) {
  return (user.role ?? "user").trim().toLowerCase();
}

function asObject(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

/** Executive entitlement. Keep the legacy function/API names for cached clients. */
export function hasManagingSeat(user: PermissionUser) {
  const role = normalizedRole(user);
  const hasActiveSubscription =
    !!user.stripeSubscriptionId &&
    user.subscriptionStatus === "active" &&
    (!user.subscriptionEndsAt ||
      new Date(user.subscriptionEndsAt) > new Date());
  return role === "admin" || (hasActiveSubscription && role !== "worker");
}

/** The full permission map for a member. */
export function resolvePermissions(user: PermissionUser): PermissionMap {
  const role = normalizedRole(user);
  if (role === "admin") {
    return Object.fromEntries(
      PERMISSION_KEYS.map((k) => [k, true]),
    ) as PermissionMap;
  }
  const managing = hasManagingSeat(user);
  const base = { ...(managing ? MANAGING_DEFAULTS : STANDARD_DEFAULTS) };
  // Executive capabilities come from the active entitlement, never from
  // editable member flags. Do not persist these defaults as permanent grants.
  if (managing) return base;
  const config = asObject(user.permissionConfig);
  if (!config) return base;

  if (config.version === 2) {
    const stored = expandDrawingPermissions(asObject(config.permissions) ?? {});
    for (const [key, value] of Object.entries(stored))
      if (isPermissionKey(key) && typeof value === "boolean") base[key] = value;
    return base;
  }

  // Legacy configuration for standard members.
  const legacy = config as LegacyPermissionConfig;
  if (legacy.actions?.canManageAssets === true) base["assets.manage"] = true;
  for (const tab of appTabIds) {
    const value = legacy.tabs?.[tab];
    if (typeof value === "boolean") base[`tab.${tab}` as PermissionKey] = value;
  }
  const a = legacy.actions ?? {};
  if (typeof a.canCreateParts === "boolean")
    base["parts.create"] = a.canCreateParts;
  if (typeof a.canEditParts === "boolean") base["parts.edit"] = a.canEditParts;
  if (a.canDeleteParts || a.canDelete) base["parts.delete"] = true;
  // Billing and organization were never grantable to standard accounts before.
  base["tab.draws"] = false;
  base["draws.edit"] = false;
  base["tab.organization"] = false;
  return base;
}

/** Compatibility for saved configs and cached clients from before the split. */
export function expandDrawingPermissions(stored: Record<string, unknown>) {
  const next = { ...stored };
  const legacy = stored["drawings.manage"];
  if (typeof legacy === "boolean") {
    for (const key of ["drawings.upload", "drawings.delete"])
      if (typeof next[key] !== "boolean") next[key] = legacy;
  }
  return next;
}

/** Stored (version 2) config for a permission map. */
export function toStoredConfig(
  map: Partial<PermissionMap>,
): StoredPermissionConfig {
  const permissions: Partial<PermissionMap> = {};
  for (const key of PERMISSION_KEYS)
    if (typeof map[key] === "boolean") permissions[key] = map[key];
  return { version: 2, permissions };
}

export function getUserPermissions(user: PermissionUser) {
  const role = normalizedRole(user);
  const isManagingAccount = hasManagingSeat(user);
  const can = resolvePermissions(user);
  const tabAccess = Object.fromEntries(
    appTabIds.map((tab) => [tab, can[`tab.${tab}` as PermissionKey] && (!["draws", "estimating"].includes(tab) || can["financial.view"])]),
  ) as Record<AppTabId, boolean>;

  return {
    role,
    isAdmin: role === "admin",
    accountType: isManagingAccount ? "managing" : "standard",
    accountTypeLabel:
      role === "admin"
        ? "Admin"
        : isManagingAccount
          ? "Executive Account"
          : "Standard Account",
    isManagingAccount,
    isStandardAccount: !isManagingAccount,
    isWorker: role === "worker",
    /** Every permission, by key. Prefer this in new code. */
    can,
    tabAccess,
    // Older fields, kept for existing clients.
    actionAccess: {
      canCreateParts: can["parts.create"],
      canEditParts: can["parts.edit"],
      canDeleteParts: can["parts.delete"],
      canDelete: can["parts.delete"],
    },
    canCreateParts: can["parts.create"],
    canEditParts: can["parts.edit"],
    canDeleteParts: can["parts.delete"],
    canManageAssets: can["assets.manage"],
    canGenerateDocuments: can["quotes.create"] || can["orders.send"],
    canDeleteCoreRecords:
      can["jobs.delete"] && can["lists.delete"] && can["suppliers.delete"],
  };
}

function labelFor(key: PermissionKey) {
  for (const group of PERMISSION_GROUPS)
    for (const p of group.permissions) if (p.key === key) return p.label;
  return key;
}

/** Throws FORBIDDEN unless the member has `key`. */
export function assertCan(
  user: PermissionUser,
  key: PermissionKey,
  message?: string,
) {
  if (!resolvePermissions(user)[key]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        message ??
        `You don't have permission to do this (${labelFor(key)}). Ask an organization manager.`,
    });
  }
}

export function userCan(user: PermissionUser, key: PermissionKey) {
  return resolvePermissions(user)[key];
}

export function assertCanAccessTab(user: PermissionUser, tab: AppTabId) {
  assertCan(
    user,
    `tab.${tab}` as PermissionKey,
    "You do not have access to this tab.",
  );
}

export function assertCanCreateParts(user: PermissionUser) {
  assertCan(
    user,
    "parts.create",
    "You do not have permission to create parts.",
  );
}

export function assertCanEditParts(user: PermissionUser) {
  assertCan(user, "parts.edit", "You do not have permission to edit parts.");
}

export function assertCanDeleteParts(user: PermissionUser) {
  assertCan(
    user,
    "parts.delete",
    "You do not have permission to delete parts.",
  );
}

export function assertCanManageAssets(user: PermissionUser) {
  assertCan(user, "assets.manage", "Only tool room members can do this.");
}
