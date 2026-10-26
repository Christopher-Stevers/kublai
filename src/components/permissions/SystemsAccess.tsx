"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { api } from "~/trpc/react";

const SystemsAccess = createContext(false);

export function SystemsAccessProvider({
  initialAllowed,
  children,
}: {
  initialAllowed: boolean;
  children: ReactNode;
}) {
  const online = useOnlineStatus();
  const { data } = api.user.getMyRole.useQuery(undefined, {
    enabled: online,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  return (
    <SystemsAccess.Provider
      value={data?.permissions.can["systems.access"] ?? initialAllowed}
    >
      {children}
    </SystemsAccess.Provider>
  );
}

export const useSystemsAccess = () => useContext(SystemsAccess);

export function SystemsAccessGate({ children }: { children: ReactNode }) {
  return useSystemsAccess() ? (
    children
  ) : (
    <p role="alert" className="bg-card rounded-xl border p-6 text-sm">
      You don’t have permission to access Systems. Ask an organization manager.
    </p>
  );
}
