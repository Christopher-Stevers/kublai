"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { api } from "~/trpc/react";

const DrawingsAccess = createContext<{
  allowed: boolean;
  canUpload?: boolean;
  canDelete?: boolean;
}>({ allowed: true });

/** Use server permissions on first render and refresh live preset assignments. */
export function DrawingsAccessProvider({
  initialAllowed,
  initialCanUpload,
  initialCanDelete,
  children,
}: {
  initialAllowed: boolean;
  initialCanUpload?: boolean;
  initialCanDelete?: boolean;
  children: ReactNode;
}) {
  const online = useOnlineStatus();
  const { data } = api.user.getMyRole.useQuery(undefined, {
    enabled: online,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const allowed = data?.permissions.can["drawings.view"] ?? initialAllowed;
  return (
    <DrawingsAccess.Provider
      value={{
        allowed,
        canUpload: data?.permissions.can["drawings.upload"] ?? initialCanUpload,
        canDelete: data?.permissions.can["drawings.delete"] ?? initialCanDelete,
      }}
    >
      {children}
    </DrawingsAccess.Provider>
  );
}

export const useDrawingCapabilities = () => useContext(DrawingsAccess);
export const useDrawingsAccess = () => useDrawingCapabilities().allowed;

export function DrawingsAccessGate({ children }: { children: ReactNode }) {
  return useDrawingsAccess() ? (
    children
  ) : (
    <p role="alert" className="bg-card rounded-xl border p-6 text-sm">
      You don’t have permission to access drawings. Ask an organization manager.
    </p>
  );
}
