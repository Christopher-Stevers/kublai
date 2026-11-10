"use client";
import { setPageInterval as setInterval, clearPageInterval as clearInterval } from "~/lib/app-page-activity";

import { useCallback, useEffect, useState } from "react";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
import {
  roundQty,
  slipItemStates,
  unmatchedLines,
  type SlipLinks,
} from "~/lib/slip-draft";
import type { PackingSlipLink } from "~/server/documents/types";

export type DraftSlip = {
  receivingReview?:{pending:number;complete:boolean;retired:boolean;missingPages?:string|null};
  id: string;
  name: string;
  createdAt: string;
  packingSlip: PackingSlipLink;
  packingSlipAnalysis?: SlipAnalysis;
  currentVersionId: string | null;
};
type Edits = {
  links: SlipLinks;
  /** This delivery's quantity per order item, where someone changed it. */
  amounts: Record<string, number>;
  problems: Record<string, boolean>;
  /** Items someone has looked at; they stop asking for a check. */
  seen: Record<string, boolean>;
};
const blank = (): Edits => ({ links: {}, amounts: {}, problems: {}, seen: {} });
const reviewable = (slip: DraftSlip) => {
  const a = slip.packingSlipAnalysis;
  return (
    !slip.receivingReview && a?.status === "ready" && !a.applied && a.versionId === slip.currentVersionId
  );
};

/** Read packing slips laid over the ordered parts on a material list, so each
 * delivery is checked on the parts themselves and confirmed once. With an
 * orderId only that order's slips are loaded. */
export function useSlipDrafts({
  jobId,
  materialListId,
  orderId,
  enabled,
  onConfirmed,
}: {
  jobId: string | null | undefined;
  materialListId: string;
  orderId?: string | null;
  enabled: boolean;
  onConfirmed?: (problems: Record<string, number>) => Promise<void> | void;
}) {
  const active = enabled && !!jobId;
  // Slips and picks belong to one list and order filter.
  const scope = `${jobId}:${materialListId}:${orderId ?? ""}`;
  const [loaded, setLoaded] = useState<{ scope: string; slips: DraftSlip[] }>({
    scope: "",
    slips: [],
  });
  const [picked, setPicked] = useState<{
    scope: string;
    ids: Record<string, string>;
  }>({ scope: "", ids: {} });
  const slips = active && loaded.scope === scope ? loaded.slips : [];
  const chosen = picked.scope === scope ? picked.ids : {};
  const [edits, setEdits] = useState<Record<string, Edits>>({});
  const [status, setStatus] = useState<
    Record<string, { busy: boolean; error: string }>
  >({});

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!jobId) return null;
      const query = new URLSearchParams({ jobId, materialListId });
      if (orderId) query.set("orderId", orderId);
      const response = await fetch(
        `/api/job-documents/packing-slips?${query}`,
        { cache: "no-store", signal },
      );
      if (!response.ok || signal?.aborted) return null;
      const result = (await response.json()) as {
        documents?: DraftSlip[];
        canUpload?: boolean;
      };
      // Only members who can receive see slips on the list.
      return {
        scope: `${jobId}:${materialListId}:${orderId ?? ""}`,
        slips: result.canUpload ? (result.documents ?? []) : [],
      };
    },
    [jobId, materialListId, orderId],
  );
  const reload = useCallback(async () => {
    const result = await load();
    if (result) setLoaded(result);
  }, [load]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    load(controller.signal)
      .then((result) => result && setLoaded(result))
      .catch(() => undefined);
    return () => controller.abort();
  }, [active, load]);
  const reading = slips.some(
    (s) => s.packingSlipAnalysis?.status === "processing",
  );
  useEffect(() => {
    if (!active || !reading) return;
    const timer = setInterval(() => {
      void reload().catch(() => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [active, reading, reload]);

  const draftFor = (order: string) => {
    const mine = slips.filter((s) => s.packingSlip.orderId === order);
    const open = mine.filter(reviewable);
    const slip =
      open.find((s) => s.id === chosen[order]) ??
      [...open].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ??
      null;
    const analysis = slip?.packingSlipAnalysis ?? null;
    // Edits belong to one reading of one slip; totals refreshes keep them.
    const key = slip && analysis ? `${slip.id}:${analysis.startedAt}` : "";
    const current = edits[key] ?? blank();
    const update = (change: (e: Edits) => Partial<Edits>) =>
      setEdits((old) => {
        const base = old[key] ?? blank();
        return { ...old, [key]: { ...base, ...change(base) } };
      });
    const states = analysis ? slipItemStates(analysis, current.links) : {};
    const { busy = false, error = "" } = status[order] ?? {};

    const item = (orderItemId: string) => {
      const it = analysis?.items.find((i) => i.id === orderItemId);
      const state = states[orderItemId];
      if (!it || !state) return null;
      const amount = current.amounts[orderItemId] ?? state.slip;
      return {
        item: it,
        ...state,
        amount,
        total: roundQty(it.received + (amount ?? 0)),
        edited: orderItemId in current.amounts,
        problem: !!current.problems[orderItemId],
        check: state.check && !current.seen[orderItemId],
      };
    };
    const items = analysis ? analysis.items.map((i) => item(i.id)!) : [];

    const post = async (
      action: "confirm" | "refresh",
      body: Record<string, unknown> = {},
    ) => {
      const res = await fetch("/api/job-documents/packing-slips/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          jobId,
          documentId: slip!.id,
          runId: analysis!.runId,
          ...body,
        }),
      });
      const result = (await res.json()) as { error?: string };
      if (!res.ok)
        throw Error(result.error ?? "Could not update this receipt.");
    };
    const setOrderStatus = (next: { busy: boolean; error: string }) =>
      setStatus((old) => ({ ...old, [order]: next }));
    const run = async (work: () => Promise<void>) => {
      setOrderStatus({ busy: true, error: "" });
      try {
        await work();
        setOrderStatus({ busy: false, error: "" });
        return true;
      } catch (e) {
        setOrderStatus({
          busy: false,
          error:
            e instanceof Error ? e.message : "Could not update this receipt.",
        });
        return false;
      }
    };

    return {
      reviewDoc: mine.find(s=>s.receivingReview&&!s.receivingReview.retired&&(s.receivingReview.pending>0||!s.receivingReview.complete)),
      orderId: order,
      orderNumber: mine[0]?.packingSlip.orderNumber ?? null,
      slip,
      analysis,
      tracking: [...mine].filter((s) => s.packingSlipAnalysis?.versionId === s.currentVersionId).sort((a, b) => (b.packingSlipAnalysis?.startedAt ?? "").localeCompare(a.packingSlipAnalysis?.startedAt ?? ""))[0]?.packingSlipAnalysis ?? null,
      reading: mine.some((s) => s.packingSlipAnalysis?.status === "processing"),
      busy,
      error,
      items,
      item,
      links: current.links,
      unmatched: analysis ? unmatchedLines(analysis, current.links) : [],
      /** Set this delivery's quantity from the part's new received total. */
      setTotal: (orderItemId: string, total: number, problem: boolean) => {
        const it = analysis?.items.find((i) => i.id === orderItemId);
        if (!it) return;
        update((e) => ({
          amounts: {
            ...e.amounts,
            [orderItemId]: roundQty(Math.max(0, total - it.received)),
          },
          problems: { ...e.problems, [orderItemId]: problem },
          seen: { ...e.seen, [orderItemId]: true },
        }));
      },
      setAmount: (orderItemId: string, amount: number | undefined) =>
        update((e) => {
          const amounts = { ...e.amounts };
          if (amount === undefined) delete amounts[orderItemId];
          else amounts[orderItemId] = amount;
          return { amounts, seen: { ...e.seen, [orderItemId]: true } };
        }),
      link: (index: number, itemId: string | null) =>
        update((e) => {
          const links = { ...e.links };
          if (itemId === analysis?.lines[index]?.orderItemId)
            delete links[index];
          else links[index] = itemId;
          return { links };
        }),
      refresh: () =>
        run(async () => {
          await post("refresh");
          await reload();
        }),
      confirm: () =>
        run(async () => {
          const quantities: Record<string, number> = {};
          for (const i of items)
            if (i.amount !== undefined) quantities[i.item.id] = i.amount;
          if (!Object.keys(quantities).length)
            throw Error("Nothing to confirm yet. Set what arrived on a part.");
          const links = Object.keys(current.links).length
            ? Object.fromEntries(Object.entries(current.links))
            : undefined;
          await post("confirm", { quantities, links });
          // Parts marked as a problem keep that mark after confirming.
          const problems = Object.fromEntries(
            items
              .filter((i) => i.problem && i.amount !== undefined)
              .map((i) => [i.item.id, i.total]),
          );
          await onConfirmed?.(problems);
          await reload();
        }),
    };
  };

  // One draft per order with a slip being read or waiting to be checked.
  const orders = [
    ...new Set(
      slips
        .filter(
          (s) =>
            (!!s.receivingReview&&!s.receivingReview.retired&&(s.receivingReview.pending>0||!s.receivingReview.complete)) || reviewable(s) || s.packingSlipAnalysis?.status === "processing" || s.packingSlipAnalysis?.status === "failed",
        )
        .map((s) => s.packingSlip.orderId),
    ),
  ];
  const drafts = orders.map(draftFor);

  return {
    slips,
    drafts,
    reload,
    /** Check this slip on the list instead of the order's newest one. */
    choose: (documentId: string) => {
      const order = slips.find((s) => s.id === documentId)?.packingSlip.orderId;
      if (order) setPicked({ scope, ids: { ...chosen, [order]: documentId } });
    },
    /** The slip draft and entry for an order item, if a slip covers it. */
    find: (orderItemId: string | null | undefined) => {
      if (!orderItemId) return null;
      for (const draft of drafts) {
        const entry = draft.item(orderItemId);
        if (entry) return { draft, entry };
      }
      return null;
    },
  };
}
export type SlipDrafts = ReturnType<typeof useSlipDrafts>;
export type SlipDraft = SlipDrafts["drafts"][number];
