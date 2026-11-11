"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryClient, hashKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api } from "~/trpc/react";
import { useDrawingAccount } from "~/components/jobs/DrawingAccountProvider";
import { useEmployeeSimulation } from "~/components/simulation/SimulationProvider";
import { captureDeviceReadAuthority } from "~/lib/device-query-cache";
import { simulationViewHeaders } from "~/lib/employee-simulation";
import {
  isAppPageActive,
  subscribeAppPageActivity,
} from "~/lib/app-page-activity";

const MAX_AGE = 30_000;
type Receipt = {
  at: number;
  order: number;
  accountKey: string | null;
  query: object;
};
type Ledger = {
  binding: object;
  role?: Receipt;
  standalone?: Receipt;
  barrier: number;
};

/** Passive observer: never creates a role query or changes its refresh cadence. */
export function useNotificationRoleIdentity(
  sessionKey: string,
  online: boolean,
) {
  const client = useQueryClient();
  const account = useDrawingAccount();
  const simulation = useEmployeeSimulation();
  const active = useSyncExternalStore(
    subscribeAppPageActivity,
    isAppPageActive,
    () => false,
  );
  const [epoch, setEpoch] = useState(0);
  const authority = captureDeviceReadAuthority();
  const view = JSON.stringify(simulationViewHeaders());
  const userId = account?.userId;
  const organizationId = account?.organizationId;
  const actorId = simulation?.actorId ?? userId;
  const simulationId = simulation?.id ?? null;
  const binding = useMemo(
    () => ({
      epoch,
      sessionKey,
      userId,
      organizationId,
      actorId,
      simulationId,
      authority,
      view,
      active,
      online,
    }),
    [
      epoch,
      sessionKey,
      userId,
      organizationId,
      actorId,
      simulationId,
      authority,
      view,
      active,
      online,
    ],
  );
  const roleHash = hashKey(getQueryKey(api.user.getMyRole, undefined, "query"));
  const identityHash = hashKey(
    getQueryKey(api.notifications.identity, { sessionKey }, "query"),
  );
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useLayoutEffect(() => {
    const cache = client.getQueryCache();
    let sequence = 0;
    const starts = new Map<object, { at: number; order: number }>();
    return cache.subscribe((event) => {
      const role = event.query.queryHash === roleHash;
      if (!role && event.query.queryHash !== identityHash) return;
      const kind = role ? "role" : "standalone";
      const validBinding =
        authority === captureDeviceReadAuthority() &&
        view === JSON.stringify(simulationViewHeaders());
      const clear = (advanceBarrier = true) => {
        const barrier = advanceBarrier ? ++sequence : null;
        setLedger((old) => ({
          ...(old?.binding === binding ? old : {}),
          binding,
          [kind]: undefined,
          barrier: Math.max(
            old?.binding === binding ? old.barrier : 0,
            barrier ?? 0,
          ),
        }));
      };
      // isActive checks enabled observers, not just observer count.
      if (event.type === "removed" || (role && !event.query.isActive())) {
        starts.delete(event.query);
        clear();
        return;
      }
      if (
        event.type !== "updated" ||
        !validBinding ||
        cache.get(event.query.queryHash) !== event.query
      )
        return;
      if (
        role &&
        (!active ||
          !online ||
          !isAppPageActive() ||
          !authority ||
          !userId ||
          !organizationId ||
          sessionKey !== userId)
      )
        return;
      if (event.action.type === "fetch") {
        starts.set(event.query, { at: Date.now(), order: ++sequence });
        return;
      }
      if (
        event.action.type === "error" ||
        (event.action.type === "success" && event.action.manual)
      ) {
        const observedStart = starts.has(event.query);
        starts.delete(event.query);
        // Joining a pre-binding request is not a fresh recovery attempt. Its
        // completion allows one actual new request; an observed failure does not.
        clear(role || event.action.type === "success" || !observedStart);
        return;
      }
      if (event.action.type !== "success") return;
      const start = starts.get(event.query);
      starts.delete(event.query);
      if (!start) {
        // cancelRefetch:false may have joined an old in-flight promise. Never
        // certify it, but wake recovery once it no longer blocks a new fetch.
        if (!role) clear();
        return;
      }
      if (role && Date.now() - start.at >= MAX_AGE) return;
      const data = event.action.data as
        | {
            accountKey?: unknown;
            notificationIdentity?: {
              accountKey?: unknown;
              userId?: unknown;
              organizationId?: unknown;
              actorId?: unknown;
              simulationId?: unknown;
            };
          }
        | undefined;
      const identity = role ? data?.notificationIdentity : data;
      if (
        !identity ||
        !(
          identity.accountKey === null ||
          (typeof identity.accountKey === "string" &&
            identity.accountKey.length > 0)
        )
      ) {
        // A fresh malformed response fails closed until normal interval/manual
        // recovery. Treating it as a new barrier would create a request loop.
        clear(role);
        return;
      }
      if (
        role &&
        (!data?.notificationIdentity ||
          data.notificationIdentity.userId !== userId ||
          data.notificationIdentity.organizationId !== organizationId ||
          data.notificationIdentity.actorId !== actorId ||
          data.notificationIdentity.simulationId !== simulationId)
      ) {
        clear();
        return;
      }
      const receipt: Receipt = {
        ...start,
        accountKey: identity.accountKey,
        query: event.query,
      };
      setNow(Date.now());
      setLedger((old) => ({
        ...(old?.binding === binding ? old : {}),
        binding,
        [kind]: receipt,
        barrier: old?.binding === binding ? old.barrier : 0,
      }));
    });
  }, [
    client,
    binding,
    roleHash,
    identityHash,
    authority,
    view,
    active,
    online,
    userId,
    organizationId,
    actorId,
    simulationId,
    sessionKey,
  ]);
  const same = ledger?.binding === binding ? ledger : null;
  const roleQuery = client.getQueryCache().get(roleHash);
  const role = same?.role;
  const shared =
    !!role &&
    role.order > Math.max(same?.barrier ?? 0, same?.standalone?.order ?? 0) &&
    role.query === roleQuery &&
    roleQuery?.isActive() === true &&
    active &&
    online &&
    Math.max(now, Date.now()) - role.at < MAX_AGE;
  useEffect(() => {
    if (!shared || !role) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, role.at + MAX_AGE - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [shared, role]);
  const standalone = same?.standalone;
  // After a shared receipt, only a later standalone HTTP completion may recover
  // fallback identity. Cached pre-shared data cannot reappear on expiry/error.
  const fallbackValid =
    !!standalone &&
    standalone.order > Math.max(same?.barrier ?? 0, role?.order ?? 0);
  const recovery = useRef<{ binding: object; key: string } | null>(null);
  const recoveryKey = `${same?.barrier ?? 0}:${role?.order ?? 0}`;
  useEffect(() => {
    if (shared || fallbackValid || !active || !online) return;
    let cancelled = false;
    // Existing identity observers may be attaching/enabling in this commit.
    queueMicrotask(() => {
      if (
        cancelled ||
        !isAppPageActive() ||
        navigator.onLine === false ||
        authority !== captureDeviceReadAuthority() ||
        view !== JSON.stringify(simulationViewHeaders())
      )
        return;
      const query = client.getQueryCache().get(identityHash);
      if (
        !query?.isActive() ||
        (recovery.current?.binding === binding &&
          recovery.current.key === recoveryKey)
      )
        return;
      recovery.current = { binding, key: recoveryKey };
      void client.refetchQueries(
        {
          queryKey: getQueryKey(
            api.notifications.identity,
            { sessionKey },
            "query",
          ),
          exact: true,
          type: "active",
        },
        { cancelRefetch: false },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [
    client,
    shared,
    fallbackValid,
    active,
    online,
    binding,
    recoveryKey,
    authority,
    view,
    identityHash,
    sessionKey,
  ]);
  const reset = useCallback(() => {
    setLedger(null);
    setEpoch((value) => value + 1);
  }, []);
  return {
    shared,
    accountKey: shared
      ? role.accountKey
      : fallbackValid
        ? standalone.accountKey
        : null,
    verified: shared || fallbackValid,
    refreshVersion: epoch,
    reset,
  };
}
