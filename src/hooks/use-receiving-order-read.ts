"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  useQuery,
  useQueryClient,
  type Query,
  type QueryKey,
} from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import { api, type RouterOutputs } from "~/trpc/react";
import {
  isSnapshotAuthorityRevoked,
  type SnapshotAuthority,
} from "~/lib/drawing-offline";
import { useDrawingAccount } from "~/components/jobs/DrawingAccountProvider";
import { useTierOneReadOptions } from "./use-tier-one-read-options";
import { getBrowserOnlineStatus } from "./use-online-status";
import { isAppPageActive } from "~/lib/app-page-activity";
import {
  captureDeviceReadAuthority,
  isDeviceReadDenial,
  reportDeviceReadDenial,
} from "~/lib/device-query-cache";
import {
  RECEIVING_READING_BUDGET,
  RECEIVING_READING_ENTRY_BUDGET,
} from "~/lib/tier-one-cache-budget";
import {
  isReceivingOrderReading,
  isReceivingAccountMismatch,
  makeReceivingOrderReading,
  RECEIVING_READING_NAMESPACE,
  type ReceivingOrderReading,
} from "~/lib/receiving-order-reading";

type Order = RouterOutputs["materialList"]["getOrderById"];
type Scope = {
  orderId: string | null;
  materialListId: string;
  jobId?: string | null;
  headerReady: boolean;
  saveReading: boolean;
};
const aborted = () =>
  new DOMException("This order reader changed.", "AbortError");
/** The saved projection never enters the raw order query or receipt authority. */
export function useReceivingOrderRead(scope: Scope) {
  const account = useDrawingAccount();
  const utils = api.useUtils();
  const client = useQueryClient();
  const authority = captureDeviceReadAuthority();
  const normalized = {
    ...scope,
    jobId: scope.saveReading ? (scope.jobId ?? null) : null,
    headerReady: scope.saveReading ? scope.headerReady : true,
    active: isAppPageActive(),
    online: getBrowserOnlineStatus(),
    account,
    authority,
  };
  const [owner, setOwner] = useState(() => normalized);
  const same =
    owner.orderId === normalized.orderId &&
    owner.materialListId === normalized.materialListId &&
    owner.jobId === normalized.jobId &&
    owner.headerReady === normalized.headerReady &&
    owner.saveReading === normalized.saveReading &&
    owner.account === account &&
    owner.authority === authority &&
    owner.active === normalized.active &&
    owner.online === normalized.online;
  if (!same) setOwner(normalized);
  const queryKey = useMemo(
    () =>
      getQueryKey(
        api.materialList.getOrderById,
        { orderId: scope.orderId ?? "" },
        "query",
      ),
    [scope.orderId],
  );
  const options = useTierOneReadOptions(
    queryKey,
    !!scope.orderId && !!account && normalized.headerReady && same,
  );
  const latest = useRef<typeof owner | null>(null);
  const requests = useRef(0),
    denial = useRef(0);
  const flight = useRef<{
    owner: typeof owner;
    query: Query;
    promise: Promise<unknown> | undefined;
    key: QueryKey;
    signal: AbortSignal;
  } | null>(null);
  const [saved, setSaved] = useState<{
    owner: typeof owner;
    value: ReceivingOrderReading;
  } | null>(null);
  const [viewMismatch, setViewMismatch] = useState<typeof owner | null>(null);
  const [cacheUnavailable, setCacheUnavailable] = useState<typeof owner | null>(
    null,
  );
  const owns = useCallback(
    (expected: typeof owner, sequence?: number, revoked?: number) =>
      latest.current === expected &&
      expected.authority === captureDeviceReadAuthority() &&
      (sequence === undefined || sequence === requests.current) &&
      (revoked === undefined || revoked === denial.current),
    [],
  );
  useLayoutEffect(() => {
    latest.current = isAppPageActive() ? owner : null;
    return () => {
      latest.current = null;
      setSaved(null);
    };
  }, [owner, options.enabled]);
  useEffect(() => {
    const revoked = (event: Event) => {
      const detail = (event as CustomEvent<{ account?: string; key?: string }>)
        .detail;
      if (
        detail?.account !== owner.account?.accountKey ||
        detail.key !== RECEIVING_READING_NAMESPACE + owner.orderId
      )
        return;
      denial.current++;
      setSaved(null);
    };
    window.addEventListener("foremanhq-snapshot-revoked", revoked);
    return () =>
      window.removeEventListener("foremanhq-snapshot-revoked", revoked);
  }, [owner]);
  useEffect(() => {
    let cancelled = false;
    const epoch = denial.current;
    const store = owner.account?.store;
    if (
      same &&
      store &&
      owner.saveReading &&
      owner.orderId &&
      owner.jobId &&
      isAppPageActive()
    ) {
      void (async () => {
        const token = await store.captureExistingSnapshotAuthority(
          RECEIVING_READING_NAMESPACE + owner.orderId,
        );
        if (!token) return;
        const value = await store.readSnapshotWithAuthority<unknown>(token);
        if (
          !cancelled &&
          owns(owner, undefined, epoch) &&
          isReceivingOrderReading(value, {
            orderId: owner.orderId!,
            materialListId: owner.materialListId,
            jobId: owner.jobId!,
          })
        )
          setSaved({ owner, value });
      })().catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [owner, same, options.enabled, owns]);
  const query = useQuery<Order, TRPCClientErrorLike<AppRouter>>({
    queryKey,
    ...options,
    queryFn: async ({ signal, queryKey: activeKey }) => {
      const activeQuery = client
        .getQueryCache()
        .find({ queryKey: activeKey, exact: true });
      const attempt = activeQuery
        ? {
            owner,
            query: activeQuery,
            promise: activeQuery.promise,
            key: activeKey,
            signal,
          }
        : null;
      flight.current = attempt;
      try {
        const expected = owner,
          sequence = ++requests.current,
          revoked = denial.current;
        const store = expected.account?.store;
        // Await the persisted key fence BEFORE dispatch, not after QueryCache success.
        let token: SnapshotAuthority | null = null;
        if (store && expected.orderId) {
          try {
            token = await store.captureSnapshotAuthority(
              RECEIVING_READING_NAMESPACE + expected.orderId,
            );
          } catch (error) {
            if (isSnapshotAuthorityRevoked(error)) {
              if (owns(expected, sequence)) {
                setSaved(null);
                setViewMismatch(expected);
              }
              throw error;
            }
            // Registration/quota may fail while an existing epoch remains readable.
            // The fallback only captures existing authority, before the HTTP read.
            try {
              token = await store.captureExistingSnapshotAuthority(
                RECEIVING_READING_NAMESPACE + expected.orderId,
              );
            } catch (error) {
              if (isSnapshotAuthorityRevoked(error)) {
                if (owns(expected, sequence)) {
                  setSaved(null);
                  setViewMismatch(expected);
                }
                throw error;
              }
              token = null;
            }
            if (!token && owns(expected, sequence, revoked)) {
              setSaved(null);
              setCacheUnavailable(expected);
            }
          }
          if (token && owns(expected, sequence, revoked))
            setCacheUnavailable(null);
        }
        if (
          !expected.orderId ||
          !expected.account ||
          !owns(expected, sequence, revoked) ||
          signal.aborted ||
          !getBrowserOnlineStatus()
        )
          throw aborted();
        try {
          const value = await utils.client.materialList.getOrderById.query(
            {
              orderId: expected.orderId,
              expectedAccountKey: expected.account.accountKey,
            },
            { signal },
          );
          if (!owns(expected, sequence, revoked) || signal.aborted)
            throw aborted();
          if (token && store) {
            try {
              // Validate persisted epochs even when another tab's hint was missed.
              // The returned SAVED value is discarded, never used as raw order data.
              await store.readSnapshotWithAuthority(token);
            } catch (error) {
              if (isSnapshotAuthorityRevoked(error)) throw error;
              token = null; // Operational storage loss: keep the real HTTP result.
              if (owns(expected, sequence, revoked)) {
                setSaved(null);
                setCacheUnavailable(expected);
              }
            }
          }
          if (!owns(expected, sequence, revoked) || signal.aborted)
            throw aborted();
          if (
            value.id !== expected.orderId ||
            value.materialListId !== expected.materialListId ||
            (expected.saveReading &&
              value.jobId &&
              expected.jobId &&
              value.jobId !== expected.jobId)
          )
            throw new Error("The order does not match this material list.");
          if (token && store && expected.saveReading && expected.jobId) {
            const projection = makeReceivingOrderReading(value, expected.jobId);
            if (projection && owns(expected, sequence, revoked)) {
              // Quota/storage failure cannot turn the accepted HTTP read into failure.
              void store
                .saveSnapshotWithAuthority(token, projection, {
                  namespace: RECEIVING_READING_NAMESPACE,
                  maxBytes: RECEIVING_READING_BUDGET,
                  maxEntryBytes: RECEIVING_READING_ENTRY_BUDGET,
                  canWrite: () => owns(expected, sequence, revoked),
                })
                .catch(() => undefined);
            }
          }
          if (owns(expected, sequence, revoked)) setViewMismatch(null);
          return value;
        } catch (error) {
          // A captured same-account denial may purge its key after a view closes;
          // it can never invalidate the new actor or publish UI into another view.
          if (
            (isSnapshotAuthorityRevoked(error) ||
              isReceivingAccountMismatch(error)) &&
            owns(expected, sequence)
          ) {
            denial.current++;
            setSaved(null);
            setViewMismatch(expected);
          }
          if (
            expected.authority === captureDeviceReadAuthority() &&
            isDeviceReadDenial(error)
          ) {
            if (!signal.aborted && sequence === requests.current) {
              if (owns(expected, sequence)) {
                denial.current++;
                setSaved(null);
                setViewMismatch(expected);
              }
              if (token && store)
                void store.revokeSnapshot(token).catch(() => undefined);
            }
            reportDeviceReadDenial(
              "materialList.getOrderById",
              "query",
              error,
              expected.authority,
            );
          }
          throw error;
        }
      } finally {
        if (flight.current === attempt) flight.current = null;
      }
    },
  });
  const priorOwner = useRef<typeof owner | null>(null);
  useLayoutEffect(() => {
    const previous = priorOwner.current;
    priorOwner.current = owner;
    const pending = flight.current;
    let cancelledOwnedFlight = false;
    if (
      pending?.promise &&
      pending.owner !== owner &&
      !pending.signal.aborted &&
      client.getQueryCache().find({ queryKey: pending.key, exact: true }) ===
        pending.query &&
      pending.query.promise === pending.promise &&
      pending.query.state.fetchStatus === "fetching"
    ) {
      // The public current-attempt promise prevents an old owner from cancelling
      // a newer notes/verifier request on this same stable query key.
      void client.cancelQueries({ queryKey: pending.key, exact: true });
      cancelledOwnedFlight = true;
    }
    const reassigned =
      previous?.account === owner.account &&
      previous.orderId === owner.orderId &&
      previous.materialListId === owner.materialListId &&
      previous.saveReading &&
      owner.saveReading &&
      previous.headerReady &&
      owner.headerReady &&
      previous.jobId !== owner.jobId;
    if ((!cancelledOwnedFlight && !reassigned) || !options.enabled) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (
        !cancelled &&
        owns(owner) &&
        getBrowserOnlineStatus() &&
        isAppPageActive()
      )
        void client.refetchQueries(
          { queryKey, exact: true, type: "active" },
          { cancelRefetch: false },
        );
    });
    return () => {
      cancelled = true;
    };
  }, [client, owner, options.enabled, owns, queryKey]);
  const denied =
    isDeviceReadDenial(query.error) ||
    isSnapshotAuthorityRevoked(query.error) ||
    isReceivingAccountMismatch(query.error) ||
    viewMismatch === owner;
  const raw = query.data;
  const scopedData =
    raw?.id === owner.orderId &&
    raw?.materialListId === owner.materialListId &&
    !(
      owner.saveReading &&
      raw?.jobId &&
      owner.jobId &&
      raw.jobId !== owner.jobId
    )
      ? raw
      : undefined;
  return {
    ...query,
    data: denied ? undefined : scopedData,
    savedReading:
      !denied &&
      cacheUnavailable !== owner &&
      !query.data &&
      saved?.owner === owner &&
      same
        ? saved.value
        : null,
  };
}

/** One active observer when notes and verification refer to the same order. */
export function useReceivingOrderReads(scope: {
  verificationOrderId: string | null;
  notesOrderId: string | null;
  materialListId: string;
  jobId?: string | null;
  headerReady: boolean;
}) {
  const verification = useReceivingOrderRead({
    orderId: scope.verificationOrderId,
    materialListId: scope.materialListId,
    jobId: scope.jobId,
    headerReady: scope.headerReady,
    saveReading: !!scope.verificationOrderId,
  });
  const distinctNotes = useReceivingOrderRead({
    orderId:
      scope.notesOrderId === scope.verificationOrderId
        ? null
        : scope.notesOrderId,
    materialListId: scope.materialListId,
    jobId: scope.jobId,
    headerReady: scope.headerReady,
    saveReading: false,
  });
  return {
    verification,
    notes:
      scope.notesOrderId === scope.verificationOrderId
        ? verification
        : distinctNotes,
  };
}
