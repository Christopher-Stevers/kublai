"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import {
  isAppPageActive,
  subscribeAppPageActivity,
} from "~/lib/app-page-activity";
import { useOnlineStatus, getBrowserOnlineStatus } from "./use-online-status";
import {
  isDeviceReadDenial,
  captureDeviceReadAuthority,
} from "~/lib/device-query-cache";

/** Opt in only a mounted, server-authorized screen's reviewed read. This does
 * not prefetch routes or change global freshness, retention or persistence. */
export function useTierOneReadOptions(queryKey: QueryKey, eligible = true) {
  const client = useQueryClient();
  const online = useOnlineStatus();
  const active = useSyncExternalStore(
    subscribeAppPageActivity,
    isAppPageActive,
    () => false,
  );
  const enabled = eligible && online && active;
  const prior = useRef<{ enabled: boolean; hash: string } | null>(null);
  const hash = JSON.stringify(queryKey);
  const latestKey = useRef(queryKey);
  useLayoutEffect(() => {
    latestKey.current = queryKey;
  });
  useEffect(() => {
    const previous = prior.current;
    prior.current = { enabled, hash };
    if (!enabled || !previous || (previous.hash === hash && previous.enabled))
      return;
    const key = latestKey.current;
    const query = client.getQueryCache().find({ queryKey: key, exact: true });
    const authority = captureDeviceReadAuthority();
    let cancelled = false;
    // In TanStack 5.90.16 useQuery updates observer options in a later effect.
    // Wait until those effects finish before asking for active-only refetch.
    queueMicrotask(() => {
      if (
        cancelled ||
        !getBrowserOnlineStatus() ||
        !isAppPageActive() ||
        authority !== captureDeviceReadAuthority() ||
        !query ||
        client.getQueryCache().find({ queryKey: key, exact: true }) !== query
      )
        return;
      void client.refetchQueries(
        { queryKey: key, exact: true, type: "active" },
        { cancelRefetch: false },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [client, enabled, hash]);
  return {
    enabled,
    refetchOnMount: "always" as const,
    refetchOnReconnect: "always" as const,
    refetchOnWindowFocus: "always" as const,
  };
}

/** A transport refresh failure keeps approved cached paint. Terminal authority
 * denials must still hide it and reach the account-wide denial fence. */
export function blocksCachedRead(query: { data: unknown; error: unknown }) {
  return Boolean(
    query.error &&
    (query.data === undefined || isDeviceReadDenial(query.error)),
  );
}
