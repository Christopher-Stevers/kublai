import { TRPCError } from "@trpc/server";
import { hasManagingSeat, getUserPermissions } from "~/server/auth/permissions";
import type { RequestUser } from "~/server/utils/get-request-identity";
export function canSimulateEmployees(actor: RequestUser | null) {
  return (
    !!actor?.organizationId &&
    (!actor.organizationAccessStatus ||
      actor.organizationAccessStatus === "approved") &&
    hasManagingSeat(actor)
  );
}
export function assertSimulationTarget(
  actor: RequestUser | null,
  employee: RequestUser | null,
) {
  if (!canSimulateEmployees(actor))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only Executive Accounts can simulate employees.",
    });
  if (!actor || employee?.organizationId !== actor.organizationId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Employee not found in your organization.",
    });
  if (actor.id === employee.id)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Choose another employee account to simulate.",
    });
  if (
    getUserPermissions(employee).isAdmin &&
    !getUserPermissions(actor).isAdmin
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only administrators can simulate an administrator account.",
    });
  if (
    employee.organizationAccessStatus &&
    employee.organizationAccessStatus !== "approved"
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only active employees can be simulated.",
    });
}
