"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
import {
  roundQty,
  slipItemStates,
  unmatchedLines,
  type SlipLinks,
} from "~/lib/slip-draft";
import type { PackingSlipLink } from "~/server/documents/types";

export type DraftSlip = {
  id: string;
  name: string;
  createdAt: string;
  packingSlip: PackingSlipLink;
  packingSlipAnalysis?: SlipAnalysis;
  currentVersionId: string | null;
};
type Edits = {
  key: string;
  links: SlipLinks;
  /** This delivery's quantity per order item, where someone changed it. */
  amounts: Record<string, number>;
  problems: Record<string, boolean>;
  /** Items someone has looked at; they stop asking for a check. */
  seen: Record<string, boolean>;
};
const blank = (key: string): Edits => ({
  key,
  links: {},
  amounts: {},
  problems: {},
  seen: {},
});
const reviewable = (slip: DraftSlip) => {
  const a = slip.packingSlipAnalysis;
  return (
    a?.status === "ready" && !a.applied && a.versionId === slip.currentVersionId
  );
};

/** A read packing slip laid over the order's parts on the material list, so
 * the delivery is checked on the parts themselves and confirmed once. */
export function useSlipDraft({
  jobId,
  materialListId,
  orderId,
  enabled,
  onConfirmed,
}: {
  jobId: string | null | undefined;
  materialListId: string;
  orderId: string | null;
  enabled: boolean;
  onConfirmed?: (problems: Record<string, number>) => Promise<void> | void;
}) {
  const [slips, setSlips] = useState<DraftSlip[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [edits, setEdits] = useState<Edits>(blank(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = enabled && !!jobId && !!orderId;

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      if (!jobId || !orderId) return;
      const query = new URLSearchParams({ jobId, materialListId, orderId });
      const response = await fetch(
        `/api/job-documents/packing-slips?${query}`,
        { cache: "no-store", signal },
      );
      if (!response.ok || signal?.aborted) return;
      const result = (await response.json()) as {
        documents?: DraftSlip[];
        canUpload?: boolean;
      };
      // Only members who can receive see the slip on the list.
      setSlips(result.canUpload ? (result.documents ?? []) : []);
    },
    [jobId, materialListId, orderId],
  );
  useEffect(() => {
    setSlips([]);
    setChosen(null);
    if (!active) return;
    const controller = new AbortController();
    void reload(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [active, reload]);
  const reading = slips.some(
    (s) => s.packingSlipAnalysis?.status === "processing",
  );
  useEffect(() => {
    if (!active || !reading) return;
    const timer = setInterval(() => {
      void reload().catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [active, reading, reload]);

  const slip = useMemo(() => {
    const open = slips.filter(reviewable);
    return (
      open.find((s) => s.id === chosen) ??
      [...open].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ??
      null
    );
  }, [slips, chosen]);
  const analysis = slip?.packingSlipAnalysis ?? null;
  // Edits belong to one reading of one slip; totals refreshes keep them.
  const key = slip && analysis ? `${slip.id}:${analysis.startedAt}` : "";
  const current = edits.key === key ? edits : blank(key);
  const update = (change: (e: Edits) => Partial<Edits>) =>
    setEdits((old) => {
      const base = old.key === key ? old : blank(key);
      return { ...base, ...change(base) };
    });
  const states = useMemo(
    () => (analysis ? slipItemStates(analysis, current.links) : {}),
    [analysis, current.links],
  );

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
    if (!res.ok) throw Error(result.error ?? "Could not update this receipt.");
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update this receipt.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    slips,
    slip,
    analysis,
    reading,
    busy,
    error,
    items,
    item,
    links: current.links,
    unmatched: analysis ? unmatchedLines(analysis, current.links) : [],
    reload,
    choose: setChosen,
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
        if (itemId === analysis?.lines[index]?.orderItemId) delete links[index];
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
}
export type SlipDraft = ReturnType<typeof useSlipDraft>;
