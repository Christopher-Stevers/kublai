"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { useOnlineStatus } from "~/hooks/use-online-status";

function tabForPath(pathname: string | null) {
  if (!pathname) return "dashboard";
  if (pathname.startsWith("/dashboard/catalogue")) return "catalogue";
  if (pathname.startsWith("/dashboard/suppliers")) return "suppliers";
  if (pathname.startsWith("/dashboard/quotes")) return "quotes";
  if (pathname.startsWith("/dashboard/orders")) return "orders";
  if (pathname.startsWith("/dashboard/organization")) return "organization";
  if (pathname.startsWith("/dashboard/account")) return null;
  return "dashboard";
}

export function TabAccessGate() {
  const pathname = usePathname();
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const { data } = api.user.getMyRole.useQuery(undefined, {
    enabled: isOnline,
  });

  useEffect(() => {
    const tab = tabForPath(pathname);
    if (!tab || !data?.permissions.tabAccess) return;
    if (data.permissions.tabAccess[tab]) return;

    router.replace(
      data.permissions.tabAccess.dashboard
        ? "/dashboard"
        : "/dashboard/account",
    );
  }, [data?.permissions.tabAccess, pathname, router]);

  return null;
}
