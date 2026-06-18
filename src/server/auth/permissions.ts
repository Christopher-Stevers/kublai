import { TRPCError } from "@trpc/server";

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
  "organization",
] as const;

export type AppTabId = (typeof appTabIds)[number];

export type UserPermissionConfig = {
  tabs?: Partial<Record<AppTabId, boolean>>;
  actions?: {
    canCreateParts?: boolean;
    canEditParts?: boolean;
    canDeleteParts?: boolean;
    canDelete?: boolean;
  };
};

const standardTabs: Record<AppTabId, boolean> = {
  dashboard: true,
  catalogue: true,
  suppliers: true,
  quotes: true,
  orders: true,
  organization: false,
};

const standardActions = {
  canCreateParts: true,
  canEditParts: true,
  canDeleteParts: false,
  canDelete: false,
};

const managingTabs: Record<AppTabId, boolean> = {
  dashboard: true,
  catalogue: true,
  suppliers: true,
  quotes: true,
  orders: true,
  organization: true,
};

const managingActions = {
  canCreateParts: true,
  canEditParts: true,
  canDeleteParts: true,
  canDelete: true,
};

function normalizedRole(user: PermissionUser) {
  return (user.role ?? "user").trim().toLowerCase();
}

function normalizePermissionConfig(input: unknown): UserPermissionConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const raw = input as UserPermissionConfig;
  return {
    tabs:
      raw.tabs && typeof raw.tabs === "object" && !Array.isArray(raw.tabs)
        ? raw.tabs
        : undefined,
    actions:
      raw.actions &&
      typeof raw.actions === "object" &&
      !Array.isArray(raw.actions)
        ? raw.actions
        : undefined,
  };
}

export function getUserPermissions(user: PermissionUser) {
  const role = normalizedRole(user);
  const hasActiveSubscription =
    !!user.stripeSubscriptionId &&
    user.subscriptionStatus === "active" &&
    (!user.subscriptionEndsAt ||
      new Date(user.subscriptionEndsAt) > new Date());
  const isWorker = role === "worker";
  const isManagingAccount =
    role === "admin" || (hasActiveSubscription && !isWorker);
  const isStandardAccount = !isManagingAccount;
  const customPermissions = isManagingAccount
    ? {}
    : normalizePermissionConfig(user.permissionConfig);
  const tabAccess = {
    ...(isManagingAccount ? managingTabs : standardTabs),
    ...customPermissions.tabs,
    organization: isManagingAccount,
  };
  const actionAccess = {
    ...(isManagingAccount ? managingActions : standardActions),
    ...customPermissions.actions,
  };

  if (actionAccess.canDelete) {
    actionAccess.canDeleteParts = true;
  }

  return {
    role,
    accountType: isManagingAccount ? "managing" : "standard",
    accountTypeLabel: isManagingAccount
      ? "Managing Account"
      : "Standard Account",
    isManagingAccount,
    isStandardAccount,
    isWorker,
    tabAccess,
    actionAccess,
    canCreateParts: actionAccess.canCreateParts,
    canEditParts: actionAccess.canEditParts,
    canDeleteParts: actionAccess.canDeleteParts,
    canGenerateDocuments: isManagingAccount,
    canDeleteCoreRecords: isManagingAccount,
  };
}

export function assertCanAccessTab(user: PermissionUser, tab: AppTabId) {
  if (!getUserPermissions(user).tabAccess[tab]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this tab.",
    });
  }
}

export function assertCanCreateParts(user: PermissionUser) {
  if (!getUserPermissions(user).canCreateParts) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to create parts.",
    });
  }
}

export function assertCanEditParts(user: PermissionUser) {
  if (!getUserPermissions(user).canEditParts) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to edit parts.",
    });
  }
}

export function assertCanDeleteParts(user: PermissionUser) {
  if (!getUserPermissions(user).canDeleteParts) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to delete parts.",
    });
  }
}

export function assertCanGenerateDocuments(user: PermissionUser) {
  if (!getUserPermissions(user).canGenerateDocuments) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Standard accounts cannot generate quotes or orders.",
    });
  }
}

export function assertCanDeleteCoreRecords(user: PermissionUser) {
  if (!getUserPermissions(user).canDeleteCoreRecords) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Standard accounts cannot delete jobs, material lists, suppliers, or parts.",
    });
  }
}

export function assertCanManageOrganization(user: PermissionUser) {
  if (!getUserPermissions(user).isManagingAccount) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Managing Account required to change organization data.",
    });
  }
}
