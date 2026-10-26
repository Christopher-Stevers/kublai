"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { useOnlineStatus } from "~/hooks/use-online-status";

function tabForPath(pathname: string | null) {
  if (!pathname) return "dashboard";
  if (pathname === "/jobs/chat" || pathname.startsWith("/jobs/chat/")) return "chat";
  if (pathname.startsWith("/jobs/catalogue")) return "catalogue";
  if (pathname.startsWith("/jobs/suppliers")) return "suppliers";
  if (pathname.startsWith("/jobs/quotes")) return "quotes";
  if (pathname.startsWith("/jobs/orders")) return "orders";
  if (pathname.startsWith("/jobs/draws")) return "draws";
  if (pathname.startsWith("/jobs/estimating")) return "estimating";
  if (pathname.startsWith("/jobs/timesheets")) return "timesheets";
  if (pathname.startsWith("/jobs/assets")) return "assets";
  if (pathname.startsWith("/jobs/organization")) return "organization";
  if (pathname.startsWith("/jobs/account")) return null;
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
        ? "/jobs"
        : "/jobs/account",
    );
  }, [data?.permissions.tabAccess, pathname, router]);

  return null;
}
