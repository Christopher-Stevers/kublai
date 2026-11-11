"use client";
import {
  useLayoutEffect,
  useEffect,
  useMemo,
  useState,
  useRef,
  useSyncExternalStore,
} from "react";
import { useQueryClient, hashKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api } from "~/trpc/react";
import {
  captureDeviceReadAuthority,
  isDeviceReadDenial,
} from "~/lib/device-query-cache";
import {
  isAppPageActive,
  subscribeAppPageActivity,
} from "~/lib/app-page-activity";
const MAX_AGE = 60_000;
type Certificate = {
  at: number;
  order: number;
  appAccess: boolean;
  canEditExecutive: boolean;
  kind: "role" | "preferences";
  query: object;
  queryHash: string;
};
type Ledger = {
  binding: object;
  role?: Certificate;
  preferences?: Certificate;
  denied?: number;
};

/** Passive cache listener only. It does not create a role observer or request.
 * Cached/manual responses cannot certify a new actor/lifecycle. */
export function useMaterialSortAuthority(
  expectedAccount: string,
  online: boolean,
  streamReady: boolean,
  input: { expectedUserId: string; expectedOrganizationId: string },
) {
  const client = useQueryClient();
  const active = useSyncExternalStore(
    subscribeAppPageActivity,
    isAppPageActive,
    () => false,
  );
  const authority = captureDeviceReadAuthority();
  const binding = useMemo(
    () => ({ expectedAccount, authority, online, active }),
    [expectedAccount, authority, online, active],
  );
  const roleKey = useMemo(
    () => getQueryKey(api.user.getMyRole, undefined, "query"),
    [],
  );
  const preferenceKey = useMemo(
    () =>
      getQueryKey(
        api.user.getMaterialSortPreferences,
        {
          expectedUserId: input.expectedUserId,
          expectedOrganizationId: input.expectedOrganizationId,
        },
        "query",
      ),
    [input.expectedUserId, input.expectedOrganizationId],
  );
  const sequence = useRef(0);
  const roleHash = useMemo(() => hashKey(roleKey), [roleKey]);
  const preferenceHash = useMemo(() => hashKey(preferenceKey), [preferenceKey]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useLayoutEffect(() => {
    if (!online || !active) return;
    const cache = client.getQueryCache();
    const starts = new Map<
      object,
      { authority: object | null; order: number; at: number }
    >();
    const stop = cache.subscribe((event) => {
      if (event.type === "removed") {
        const kind =
          event.query.queryHash === roleHash
            ? "role"
            : event.query.queryHash === preferenceHash
              ? "preferences"
              : null;
        if (kind) {
          starts.delete(event.query);
          setLedger((old) =>
            old?.binding === binding ? { ...old, [kind]: undefined } : old,
          );
        }
        return;
      }
      if (
        event.type !== "updated" ||
        authority !== captureDeviceReadAuthority() ||
        !isAppPageActive()
      )
        return;
      const kind =
        event.query.queryHash === roleHash
          ? "role"
          : event.query.queryHash === preferenceHash
            ? "preferences"
            : null;
      if (!kind || cache.get(event.query.queryHash) !== event.query) return;
      if (event.action.type === "fetch") {
        starts.set(event.query, {
          authority: captureDeviceReadAuthority(),
          order: ++sequence.current,
          at: Date.now(),
        });
        return;
      }
      const start = starts.get(event.query);
      if (start?.authority !== captureDeviceReadAuthority()) return;
      if (event.action.type === "error") {
        starts.delete(event.query);
        if (isDeviceReadDenial(event.action.error)) {
          const denied = start.order;
          setLedger((old) => ({
            ...(old?.binding === binding ? old : {}),
            binding,
            denied: Math.max(
              old?.binding === binding ? (old.denied ?? -1) : -1,
              denied,
            ),
          }));
        }
        return;
      }
      if (event.action.type !== "success" || event.action.manual) return;
      starts.delete(event.query);
      // A slow old request neither outranks a newer permission decision nor
      // renews authority for60seconds from its eventual completion.
      if (Date.now() - start.at >= MAX_AGE) return;
      const data: unknown = event.action.data;
      if (
        !data ||
        typeof data !== "object" ||
        !("canEditExecutive" in data) ||
        typeof data.canEditExecutive !== "boolean"
      )
        return;
      if (
        kind === "role" &&
        (!("accountScope" in data) ||
          data.accountScope !== expectedAccount ||
          !("appAccess" in data) ||
          typeof data.appAccess !== "boolean")
      )
        return;
      const cert: Certificate = {
        at: start.at,
        order: start.order,
        kind,
        query: event.query,
        queryHash: event.query.queryHash,
        appAccess:
          kind === "preferences" ||
          ("appAccess" in data && data.appAccess === true),
        canEditExecutive: data.canEditExecutive,
      };
      setNow(Date.now());
      setLedger((old) => ({
        ...(old?.binding === binding ? old : {}),
        binding,
        [kind]: cert,
      }));
    });
    return () => {
      starts.clear();
      stop();
    };
  }, [
    client,
    roleKey,
    preferenceKey,
    roleHash,
    preferenceHash,
    expectedAccount,
    authority,
    binding,
    online,
    active,
  ]);
  const same = ledger?.binding === binding ? ledger : null;
  const fresh = (cert?: Certificate) =>
    cert !== undefined &&
    client.getQueryCache().get(cert.queryHash) === cert.query &&
    now - cert.at < MAX_AGE;
  const latest = [same?.role, same?.preferences]
    .filter((cert): cert is Certificate => fresh(cert))
    .sort((a, b) => b.order - a.order)[0];
  const allowed =
    latest !== undefined &&
    latest.order > (same?.denied ?? -1) &&
    latest.appAccess;
  const suppressPoll =
    online &&
    active &&
    streamReady &&
    fresh(same?.role) &&
    same?.role?.appAccess === true &&
    allowed;
  // One deadline, not a polling/request loop. Stalled role HTTP cannot leave a
  // healthy stream suppressing fallback indefinitely. Paused pages have none.
  useEffect(() => {
    if (!online || !active || !same) return;
    const expiries = [same.role, same.preferences]
      .filter((cert): cert is Certificate => cert !== undefined)
      .map((cert) => cert.at + MAX_AGE)
      .filter((at) => at > Date.now());
    if (!expiries.length) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(...expiries) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [online, active, same, now]);
  // Refetch only the already-active preference query on fallback/visible return.
  // Wait for observer effects; never fetch a role or a new query key.
  useEffect(() => {
    if (!online || !active || suppressPoll) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (
        cancelled ||
        !isAppPageActive() ||
        navigator.onLine === false ||
        authority !== captureDeviceReadAuthority()
      )
        return;
      void client.refetchQueries(
        { queryKey: preferenceKey, exact: true, type: "active" },
        { cancelRefetch: false },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [client, online, active, suppressPoll, preferenceKey, authority, binding]);
  return {
    active,
    suppressPoll,
    editable: online && active && allowed,
    canEditExecutive: allowed && latest.canEditExecutive,
  };
}
