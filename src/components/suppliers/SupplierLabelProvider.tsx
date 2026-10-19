"use client";
import { usePathname } from "next/navigation";
import { api } from "~/trpc/react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { SupplierLabelContext } from "./SupplierLabel";
export function SupplierLabelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const jobId = pathname?.match(
    /^\/dashboard\/jobs\/([0-9a-f-]{36})(?:\/|$)/i,
  )?.[1];
  const materialListId = pathname?.match(
    /^\/dashboard\/material-lists\/([0-9a-f-]{36})(?:\/|$)/i,
  )?.[1];
  const online = useOnlineStatus();
  const active = !!(jobId || materialListId);
  const query = api.supplierPriceBooks.labelContext.useQuery(
    { jobId, materialListId },
    { enabled: active && online, staleTime: 30_000 },
  );
  return (
    <SupplierLabelContext.Provider
      value={{
        entries: active ? (query.data ?? []) : [],
        pending: active && !query.data,
        unavailable: active && !query.data && (!online || query.isError),
      }}
    >
      {children}
    </SupplierLabelContext.Provider>
  );
}
