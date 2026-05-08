import { TRPCError } from "@trpc/server";

type PermissionUser = {
  role?: string | null;
  hasOneTimeAccess?: boolean | null;
};

function normalizedRole(user: PermissionUser) {
  return (user.role ?? "user").trim().toLowerCase();
}

export function getUserPermissions(user: PermissionUser) {
  const role = normalizedRole(user);
  const isBetaTester = user.hasOneTimeAccess === true;
  const isWorker = role === "worker";
  const isRestrictedFieldRole = isWorker || isBetaTester;

  return {
    role,
    isBetaTester,
    canGenerateDocuments: !isRestrictedFieldRole,
    canDeleteCoreRecords: !isRestrictedFieldRole,
  };
}

export function assertCanGenerateDocuments(user: PermissionUser) {
  if (!getUserPermissions(user).canGenerateDocuments) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Workers and beta testers cannot generate quotes or orders.",
    });
  }
}

export function assertCanDeleteCoreRecords(user: PermissionUser) {
  if (!getUserPermissions(user).canDeleteCoreRecords) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Workers and beta testers cannot delete jobs, material lists, suppliers, or parts.",
    });
  }
}
