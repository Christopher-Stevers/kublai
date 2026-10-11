"use client";

import type { ReactNode } from "react";
import { api } from "~/trpc/react";

export function useEstimatingPermissions() {
  const role = api.user.getMyRole.useQuery(undefined, {
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const can = role.data?.permissions.can as Record<string, boolean> | undefined;
  return {
    loading: role.isLoading,
    error: role.error,
    allowed:
      can?.["financial.view"] === true && can?.["tab.estimating"] === true,
    edit: can?.["estimating.edit"] === true,
    approve: can?.["estimating.approve"] === true,
    drawings: can?.["drawings.view"] === true,
    listsEdit: can?.["lists.edit"] === true,
  };
}

export function EstimatingAccess({ children }: { children: ReactNode }) {
  const permissions = useEstimatingPermissions();
  if (permissions.loading)
    return (
      <p role="status" className="text-muted-foreground p-6 text-sm">
        Loading estimating permissions…
      </p>
    );
  if (!permissions.allowed)
    return (
      <p role="alert" className="p-6 text-sm">
        {permissions.error
          ? "Estimating permissions could not be loaded. Reload to try again."
          : "You don’t have access to estimating. Ask an organization manager for estimating and dollar-value access."}
      </p>
    );
  return children;
}
