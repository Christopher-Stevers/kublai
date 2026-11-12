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
import { useQuery } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api } from "~/trpc/react";
import { useEmployeeSimulation } from "~/components/simulation/SimulationProvider";
import { NOTIFICATION_POLL_MS } from "~/lib/app-notifications";
import {
  isAppPageActive,
  subscribeAppPageActivity,
} from "~/lib/app-page-activity";
import { getBrowserOnlineStatus, useOnlineStatus } from "./use-online-status";

/** One inbox owns the existing overview cadence. Only actual RPC completion can
 * replace identity polling; cached/manual/hydrated query data cannot do so. */
export function useNotificationAccount(sessionKey: string) {
  const utils = api.useUtils();
  const online = useOnlineStatus();
  const active = useSyncExternalStore(
    subscribeAppPageActivity,
    isAppPageActive,
    () => false,
  );
  const simulation = useEmployeeSimulation();
  const eligible = online && active;
  const lifecycle = useMemo(
    () => ({ sessionKey, simulationId: simulation?.id }),
    [sessionKey, simulation?.id],
  );
  const mounted = useRef<object | null>(null);
  const mountEpoch = useRef(0);
  useLayoutEffect(() => {
    mounted.current = lifecycle;
    const epoch = ++mountEpoch.current;
    setOwner(null);
    return () => {
      if (mounted.current === lifecycle) {
        mounted.current = null;
        mountEpoch.current = epoch + 1;
      }
    };
  }, [lifecycle, eligible]);
  const authorityEpoch = useRef(0);
  const [catchup, setCatchup] = useState(0);
  const [blocked, setBlocked] = useState<object | null>(null);
  const identityReceipt = useRef<{
    lifecycle: object;
    epoch: number;
    authority: number;
  } | null>(null);
  const identityAttempt = useRef<{
    lifecycle: object;
    epoch: number;
    authority: number;
  } | null>(null);
  const overviewAttempt = useRef<{
    lifecycle: object;
    account: object;
    epoch: number;
    authority: number;
  } | null>(null);
  const boundGeneration = useRef<object | null>(null);
  const boundAccount = useRef<string | null>(null);
  const current = useCallback(
    () =>
      mounted.current === lifecycle &&
      eligible &&
      getBrowserOnlineStatus() &&
      isAppPageActive(),
    [lifecycle, eligible],
  );
  const [binding, setBinding] = useState<{
    lifecycle: object;
    accountKey: string | null;
  } | null>(null);
  const [owner, setOwner] = useState<{
    lifecycle: object;
    accountKey: string;
  } | null>(null);
  const accountKey =
    binding?.lifecycle === lifecycle ? binding.accountKey : null;
  const accountGeneration = useMemo(() => ({ accountKey }), [accountKey]);
  useLayoutEffect(() => {
    boundAccount.current = accountKey;
    boundGeneration.current = accountGeneration;
  }, [accountKey, accountGeneration]);
  const overviewOwns =
    eligible &&
    Boolean(accountKey) &&
    owner?.lifecycle === lifecycle &&
    owner.accountKey === accountKey;
  const identity = useQuery({
    queryKey: getQueryKey(api.notifications.identity, { sessionKey }, "query"),
    queryFn: async ({ signal }) => {
      identityAttempt.current = {
        lifecycle,
        epoch: mountEpoch.current,
        authority: authorityEpoch.current,
      };
      const epoch = mountEpoch.current;
      const authority = authorityEpoch.current;
      let result;
      try {
        result = await utils.client.notifications.identity.query(
          { sessionKey },
          { signal },
        );
      } catch (error) {
        if (
          !signal.aborted &&
          current() &&
          epoch === mountEpoch.current &&
          authority === authorityEpoch.current
        ) {
          setBinding(null);
          setOwner(null);
        }
        throw error;
      }
      if (
        signal.aborted ||
        !current() ||
        epoch !== mountEpoch.current ||
        authority !== authorityEpoch.current
      )
        throw new DOMException(
          "Superseded notification identity",
          "AbortError",
        );
      identityReceipt.current = { lifecycle, epoch, authority };
      setBinding({ lifecycle, accountKey: result.accountKey });
      setBlocked(null);
      if (result.accountKey !== boundAccount.current) setOwner(null);
      return result;
    },
    enabled: eligible,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: overviewOwns ? false : NOTIFICATION_POLL_MS,
    retry: false,
  });
  const overview = useQuery({
    queryKey: getQueryKey(
      api.notifications.overview,
      { accountKey: accountKey ?? "" },
      "query",
    ),
    queryFn: async ({ signal }) => {
      const expected = accountKey;
      overviewAttempt.current = {
        lifecycle,
        account: accountGeneration,
        epoch: mountEpoch.current,
        authority: authorityEpoch.current,
      };
      const epoch = mountEpoch.current;
      const authority = authorityEpoch.current;
      try {
        const result = await utils.client.notifications.overview.query(
          { accountKey: expected ?? "" },
          { signal },
        );
        if (
          signal.aborted ||
          !current() ||
          boundAccount.current !== expected ||
          boundGeneration.current !== accountGeneration ||
          epoch !== mountEpoch.current ||
          authority !== authorityEpoch.current
        )
          throw new DOMException(
            "Superseded notification overview",
            "AbortError",
          );
        if (!expected || result.accountKey !== expected)
          throw Object.assign(new Error("Notification account changed"), {
            data: { code: "CONFLICT" },
          });
        const receipt = identityReceipt.current;
        if (
          receipt?.lifecycle === lifecycle &&
          receipt.epoch === mountEpoch.current &&
          receipt.authority === authorityEpoch.current
        ) {
          setOwner({ lifecycle, accountKey: expected });
        }
        return result;
      } catch (error) {
        if (
          !signal.aborted &&
          current() &&
          boundAccount.current === expected &&
          boundGeneration.current === accountGeneration &&
          epoch === mountEpoch.current &&
          authority === authorityEpoch.current
        ) {
          setOwner(null);
          const code = (error as { data?: { code?: string } }).data?.code;
          if (
            code === "UNAUTHORIZED" ||
            code === "FORBIDDEN" ||
            code === "CONFLICT"
          )
            setBlocked(lifecycle);
          // A response that began before this failure cannot certify recovery.
          // Keep the same overview key enabled: toggling it on every refusal
          // would form an identity-success -> overview-error request loop.
          authorityEpoch.current++;
          // This completed refusal already requested identity recovery. It is
          // not an old shared-key attempt that should be retried immediately.
          overviewAttempt.current = {
            lifecycle,
            account: accountGeneration,
            epoch,
            authority: authorityEpoch.current,
          };
          setCatchup((value) => value + 1);
        }
        throw error;
      }
    },
    enabled: eligible && Boolean(accountKey),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: NOTIFICATION_POLL_MS,
    retry: false,
  });
  const refetchIdentity = identity.refetch;
  const refetchOverview = overview.refetch;
  const overviewFetchStatus = overview.fetchStatus;
  const overviewFetched = overview.isFetched;
  // One bounded catchup per lifecycle/error, without cancelling a shared
  // in-flight request. If that request predates our authority epoch, wait for it
  // and then start one fresh RPC. A current failed attempt is not retried here.
  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    const expectedAuthority = authorityEpoch.current;
    const run = async () => {
      const attempted = identityAttempt.current;
      if (
        attempted?.lifecycle === lifecycle &&
        attempted.epoch === mountEpoch.current &&
        attempted.authority === expectedAuthority
      )
        return;
      await refetchIdentity({ cancelRefetch: false });
      const after = identityAttempt.current;
      if (
        !cancelled &&
        current() &&
        expectedAuthority === authorityEpoch.current &&
        (after?.lifecycle !== lifecycle ||
          after.epoch !== mountEpoch.current ||
          after.authority !== expectedAuthority)
      ) {
        await refetchIdentity({ cancelRefetch: false });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [eligible, lifecycle, catchup, current, refetchIdentity]);
  useEffect(() => {
    if (
      !eligible ||
      !accountKey ||
      overviewFetchStatus !== "idle" ||
      !overviewFetched ||
      (overviewAttempt.current?.lifecycle === lifecycle &&
        overviewAttempt.current.account === accountGeneration &&
        overviewAttempt.current.epoch === mountEpoch.current &&
        overviewAttempt.current.authority === authorityEpoch.current)
    )
      return;
    overviewAttempt.current = {
      lifecycle,
      account: accountGeneration,
      epoch: mountEpoch.current,
      authority: authorityEpoch.current,
    };
    void refetchOverview({ cancelRefetch: false });
  }, [
    eligible,
    accountKey,
    accountGeneration,
    lifecycle,
    overviewFetchStatus,
    overviewFetched,
    refetchOverview,
    catchup,
  ]);
  return {
    accountKey: blocked === lifecycle ? null : accountKey,
    online,
    identity,
    overview,
    refreshIdentity: () => {
      setOwner(null);
      authorityEpoch.current++;
      setCatchup((value) => value + 1);
    },
  };
}
