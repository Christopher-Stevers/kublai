"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckIcon, ChevronRightIcon, ClipboardCheckIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ListPageSkeleton } from "~/components/ui/skeleton";
import { confirmAction } from "~/components/ui/app-dialogs";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

import {
  AssetsShell,
  EmptyState,
  ErrorText,
  HolderIcon,
  HolderSelect,
  ToolStatusBadge,
  formatQty,
  formatWhen,
  useIsOnline,
  useToolRoom,
  type HolderRef,
} from "./shared";
import { TagScanner } from "./TagScanner";

const COUNT_STATUS: Record<string, string> = { open: "In progress", completed: "Completed", cancelled: "Cancelled" };

export function CountsView() {
  const router = useRouter();
  const isOnline = useIsOnline();
  const { canManage } = useToolRoom();
  const utils = api.useUtils();
  const counts = api.assets.listCounts.useQuery({ status: "all" }, { enabled: isOnline });
  const holders = api.assets.holders.useQuery(undefined, { enabled: isOnline && canManage });
  const [target, setTarget] = useState<HolderRef | null>(null);
  const start = api.assets.startCount.useMutation({
    onSuccess: async (count) => {
      await utils.assets.listCounts.invalidate();
      router.push(`/dashboard/assets/counts/${count.id}`);
    },
  });

  return (
    <AssetsShell title="Counts & audits" description="Check what's really in a yard, vehicle, job or someone's hands">
      {canManage && (
        <div className="bg-card flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
          <span className="text-sm font-medium">Start a count at</span>
          <div className="flex-1">
            <HolderSelect holders={holders.data} value={target} onChange={setTarget} />
          </div>
          <Button disabled={!target || start.isPending} onClick={() => target && start.mutate({ holder: target })}>
            <ClipboardCheckIcon className="mr-2 h-4 w-4" /> Start count
          </Button>
        </div>
      )}
      <ErrorText message={start.error?.message} />
      {counts.isLoading ? (
        <ListPageSkeleton label="Loading counts" />
      ) : counts.error ? (
        <ErrorText message={counts.error.message} />
      ) : !counts.data?.length ? (
        <EmptyState icon={<ClipboardCheckIcon />} title="No counts yet">
          A count lists everything that should be somewhere; tick off what&apos;s there (or scan the
          labels) and anything not found is marked missing.
        </EmptyState>
      ) : (
        <div className="bg-card divide-y rounded-lg border">
          {counts.data.map((c) => (
            <Link key={c.id} href={`/dashboard/assets/counts/${c.id}`} className="hover:bg-accent flex items-center gap-3 p-3">
              <HolderIcon kind={c.holder.kind} className="text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.holder.label}</span>
                  <Badge variant={c.status === "open" ? "default" : "outline"}>{COUNT_STATUS[c.status] ?? c.status}</Badge>
                </div>
                <div className="text-muted-foreground text-xs sm:text-sm">
                  {formatWhen(c.createdAt)} · {c.startedBy ?? "Unknown"} · {c.counted} of {c.lines} counted
                </div>
              </div>
              <ChevronRightIcon className="text-muted-foreground h-4 w-4" />
            </Link>
          ))}
        </div>
      )}
    </AssetsShell>
  );
}

type Count = RouterOutputs["assets"]["getCount"];
type CountLine = Count["lines"][number];

export function CountDetail({ countId }: { countId: string }) {
  const isOnline = useIsOnline();
  const utils = api.useUtils();
  const query = api.assets.getCount.useQuery({ countId }, { enabled: isOnline });
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [summary, setSummary] = useState<RouterOutputs["assets"]["completeCount"] | null>(null);
  const refresh = () => utils.assets.getCount.invalidate({ countId });
  const record = api.assets.recordCountLine.useMutation({ onSuccess: refresh });
  const scan = api.assets.scanForCount.useMutation({
    onSuccess: async (result) => {
      await refresh();
      setMessage(
        result.expected
          ? { text: `✓ ${result.tag} ${result.name}`, tone: "ok" }
          : { text: `${result.tag} ${result.name} wasn't expected here. It will be moved here when you finish.`, tone: "warn" },
      );
    },
    onError: (error) => setMessage({ text: error.message, tone: "warn" }),
  });
  const complete = api.assets.completeCount.useMutation({
    onSuccess: async (result) => {
      setSummary(result);
      await utils.assets.invalidate();
    },
  });
  const cancel = api.assets.cancelCount.useMutation({ onSuccess: () => utils.assets.invalidate() });

  const count = query.data;
  const isOpen = count?.status === "open" && count.canManageAssets;
  const lines = count?.lines ?? [];
  const counted = lines.filter((l) => l.counted !== null).length;
  const tagged = lines.filter((l) => l.tracking === "serialized");
  const quantity = lines.filter((l) => l.tracking === "quantity");

  return (
    <AssetsShell
      title={count ? `Count: ${count.holder.label}` : "Count"}
      description={count ? `Started ${formatWhen(count.createdAt)} · ${counted} of ${lines.length} counted` : undefined}
    >
      {query.isLoading ? (
        <ListPageSkeleton label="Loading count" />
      ) : query.error || !count ? (
        <ErrorText message={query.error?.message ?? "Count not found."} />
      ) : (
        <div className="space-y-4">
          {summary && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
              <div className="font-semibold">Count completed</div>
              {summary.missing} marked missing · {summary.found} found or moved here · {summary.adjusted} quantities corrected ·{" "}
              {summary.unchanged} matched{summary.skipped ? ` · ${summary.skipped} not counted (left unchanged)` : ""}
            </div>
          )}
          {count.status !== "open" && !summary && (
            <p className="bg-muted rounded-lg px-3 py-2 text-sm">This count is {COUNT_STATUS[count.status]?.toLowerCase()}.</p>
          )}
          {isOpen && (
            <div className="space-y-1">
              <TagScanner busy={scan.isPending} onTag={(tag) => scan.mutate({ countId, tag })} autoFocus />
              {message && (
                <p className={cn("text-sm", message.tone === "ok" ? "text-emerald-700" : "text-amber-700")}>{message.text}</p>
              )}
            </div>
          )}

          {tagged.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-semibold">Tagged tools</h3>
              <div className="bg-card divide-y rounded-lg border">
                {tagged.map((line) => (
                  <TaggedLine key={line.id} line={line} disabled={!isOpen} onSet={(value) => record.mutate({ lineId: line.id, counted: value })} />
                ))}
              </div>
            </section>
          )}
          {quantity.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-semibold">Counted by quantity</h3>
              <div className="bg-card divide-y rounded-lg border">
                {quantity.map((line) => (
                  <QuantityLine key={line.id} line={line} disabled={!isOpen} onSet={(value) => record.mutate({ lineId: line.id, counted: value })} />
                ))}
              </div>
            </section>
          )}
          {lines.length === 0 && <p className="text-muted-foreground text-sm">Nothing is expected here. Scan anything you find.</p>}

          <ErrorText message={record.error?.message ?? complete.error?.message ?? cancel.error?.message} />
          {isOpen && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="lg"
                disabled={complete.isPending}
                onClick={async () => {
                  const missing = tagged.filter((l) => l.counted === 0 && l.expected > 0).length;
                  const ok = await confirmAction({
                    title: "Finish this count?",
                    description: `${missing} tool${missing === 1 ? "" : "s"} will be marked missing and quantities will be corrected. Anything left uncounted (${lines.length - counted}) is not changed.`,
                    confirmLabel: "Finish count",
                  });
                  if (ok) complete.mutate({ countId });
                }}
              >
                {complete.isPending ? "Finishing…" : "Finish count"}
              </Button>
              <Button variant="outline" size="lg" disabled={cancel.isPending} onClick={() => cancel.mutate({ countId })}>
                Cancel count
              </Button>
            </div>
          )}
        </div>
      )}
    </AssetsShell>
  );
}

function TaggedLine({ line, disabled, onSet }: { line: CountLine; disabled: boolean; onSet: (value: number | null) => void }) {
  const found = line.counted === 1;
  const notFound = line.counted === 0;
  return (
    <div className={cn("flex items-center gap-3 px-3 py-2", line.expected === 0 && "bg-amber-50/60")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold">{line.assetTag}</span>
          <span className="text-sm font-medium">{line.name}</span>
          {line.expected === 0 && <span className="text-xs text-amber-800">found here, not expected</span>}
          {line.assetStatus && line.assetStatus !== "available" && line.assetStatus !== "in_use" && <ToolStatusBadge status={line.assetStatus} />}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          size="sm"
          variant={found ? "default" : "outline"}
          className={cn("h-8", found && "bg-emerald-600 hover:bg-emerald-700")}
          disabled={disabled}
          onClick={() => onSet(found ? null : 1)}
          aria-label={`${line.assetTag} is here`}
        >
          <CheckIcon className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant={notFound ? "destructive" : "outline"}
          className="h-8"
          disabled={disabled || line.expected === 0}
          onClick={() => onSet(notFound ? null : 0)}
        >
          Not here
        </Button>
      </div>
    </div>
  );
}

function QuantityLine({ line, disabled, onSet }: { line: CountLine; disabled: boolean; onSet: (value: number | null) => void }) {
  const [draft, setDraft] = useState(line.counted === null ? "" : String(line.counted));
  useEffect(() => setDraft(line.counted === null ? "" : String(line.counted)), [line.counted]);
  const commit = () => {
    const trimmed = draft.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && !(value >= 0)) return;
    if (value !== line.counted) onSet(value);
  };
  const off = line.counted !== null && line.counted !== line.expected;
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{line.name}</div>
        <div className="text-muted-foreground text-xs">Expected {formatQty(line.expected)}</div>
      </div>
      <Input
        className={cn("h-8 w-24 text-right", off && "border-amber-500")}
        inputMode="decimal"
        placeholder="count"
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        aria-label={`Counted ${line.name}`}
      />
    </div>
  );
}
