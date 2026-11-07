"use client";

import { createContext, useContext, type ReactNode } from "react";
import { api } from "~/trpc/react";

const FinancialVisibility = createContext(true);

/** Server-provided initial value prevents a price flash before permissions load. */
export function FinancialVisibilityProvider({ initialVisible, children }: {
  initialVisible: boolean;
  children: ReactNode;
}) {
  const { data } = api.user.getMyRole.useQuery(undefined, {
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const visible = data ? data.permissions.can["financial.view"] === true : initialVisible;
  return <FinancialVisibility.Provider value={visible}>{children}</FinancialVisibility.Provider>;
}

export function useFinancialVisibility() {
  return useContext(FinancialVisibility);
}

/** Removes monetary fields from the DOM, including dialogs rendered in portals. */
export function FinancialOnly({ children }: { children: ReactNode }) {
  return useFinancialVisibility() ? children : null;
}
