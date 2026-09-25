"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { ArrowRightLeftIcon, PlusIcon, PrinterIcon, SearchIcon, WrenchIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ListPageSkeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

import { AddToolsDialog, MoveDialog } from "./AssetDialogs";
import {
  AssetsShell,
  EmptyState,
  ErrorText,
  HolderLink,
  ToolStatusBadge,
  formatQty,
  selectClass,
  useIsOnline,
  useToolRoom,
  type HolderRef,
} from "./shared";

const STATUSES = ["available", "in_use", "damaged", "missing", "retired"] as const;
type Status = (typeof STATUSES)[number];

export function ToolsView() {
  const router = useRouter();
  const params = useSearchParams();
  const isOnline = useIsOnline();
  const { canManage } = useToolRoom();
  const status = (STATUSES as readonly string[]).includes(params.get("status") ?? "") ? (params.get("status") as Status) : undefined;
  const partId = params.get("type") ?? undefined;
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const types = api.assets.listTypes.useQuery(undefined, { enabled: isOnline });
  const tools = api.assets.listAssets.useQuery(
    { status, partId, search: deferredSearch || undefined, limit: 500 },
    { enabled: isOnline },
  );
  const type = types.data?.find((t) => t.partId === partId);
  const stock = api.assets.listStock.useQuery({ partId }, { enabled: isOnline && type?.tracking === "quantity" });

  const setFilter = (key: "status" | "type", value: string | undefined) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    setSelected(new Set());
    router.replace(`/dashboard/assets/tools${next.size ? `?${next}` : ""}`);
  };

  const rows = tools.data ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <AssetsShell
      title="Tools"
      description="Every tool type, and each tagged tool with where it is right now"
      actions={
        canManage && (
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon className="mr-2 h-4 w-4" /> Add tools
          </Button>
        )
      }
    >
      {types.isLoading ? (
        <ListPageSkeleton label="Loading tools" />
      ) : types.error ? (
        <ErrorText message={types.error.message} />
      ) : !types.data?.length ? (
        <EmptyState icon={<WrenchIcon />} title="No tool types yet">
          Start by adding tool types (e.g. &ldquo;Hilti TE 30 hammer drill&rdquo;) on the{" "}
          <Link href="/dashboard/assets/types" className="text-primary hover:underline">
            Tool Types
          </Link>{" "}
          page, then add the tools you own.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          <div className="bg-card overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-muted-foreground border-b text-xs">
                <tr>
                  <th className="p-2.5 text-left font-medium">Tool type</th>
                  <th className="p-2.5 text-right font-medium">Available</th>
                  <th className="p-2.5 text-right font-medium">Out</th>
                  <th className="p-2.5 text-right font-medium">Damaged</th>
                  <th className="p-2.5 text-right font-medium">Missing</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {types.data.map((t) => (
                  <tr
                    key={t.partId}
                    className={cn("hover:bg-accent cursor-pointer", t.partId === partId && "bg-accent", !t.isActive && "opacity-60")}
                    onClick={() => setFilter("type", t.partId === partId ? undefined : t.partId)}
                  >
                    <td className="p-2.5">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {t.tracking === "quantity" ? "Counted by quantity" : "Tagged individually"}
                      </div>
                    </td>
                    <td className="p-2.5 text-right tabular-nums">{formatQty(t.available)}</td>
                    <td className="p-2.5 text-right tabular-nums">{formatQty(t.inUse)}</td>
                    <td className={cn("p-2.5 text-right tabular-nums", t.damaged > 0 && "font-semibold text-amber-700")}>{t.damaged || ""}</td>
                    <td className={cn("p-2.5 text-right tabular-nums", t.missing > 0 && "font-semibold text-red-700")}>{t.missing || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {type?.tracking === "quantity" ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{type.name}: where it is</h3>
                <Button variant="ghost" size="sm" onClick={() => setFilter("type", undefined)}>
                  Clear
                </Button>
              </div>
              <div className="bg-card divide-y rounded-lg border">
                {(stock.data ?? []).map((s) => (
                  <div key={`${s.holderType}:${s.holderId}`} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <HolderLink holder={{ type: s.holderType as HolderRef["type"], id: s.holderId }} label={s.holder.label} kind={s.holder.kind} />
                    <span className="font-semibold tabular-nums">{formatQty(s.quantity)}</span>
                  </div>
                ))}
                {stock.data?.length === 0 && <p className="text-muted-foreground p-3 text-sm">None on hand.</p>}
              </div>
            </section>
          ) : (
            <section className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
                  <Input
                    className="pl-8"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search tag, serial or tool name"
                  />
                </div>
                <select className={cn(selectClass, "sm:w-40")} value={status ?? ""} onChange={(event) => setFilter("status", event.target.value || undefined)}>
                  <option value="">Any status</option>
                  <option value="available">Available</option>
                  <option value="in_use">In use</option>
                  <option value="damaged">Damaged</option>
                  <option value="missing">Missing</option>
                  <option value="retired">Retired</option>
                </select>
                {type && (
                  <Button variant="outline" onClick={() => setFilter("type", undefined)}>
                    {type.name} ✕
                  </Button>
                )}
              </div>

              {selected.size > 0 && (
                <div className="bg-muted flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm">
                  <span className="font-medium">{selected.size} selected</span>
                  <Button size="sm" variant="outline" onClick={() => setMoveOpen(true)}>
                    <ArrowRightLeftIcon className="mr-1.5 h-4 w-4" /> Move
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/dashboard/assets/labels?ids=${[...selected].join(",")}`} target="_blank" rel="noreferrer">
                      <PrinterIcon className="mr-1.5 h-4 w-4" /> Labels
                    </a>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                </div>
              )}

              {tools.isLoading ? (
                <ListPageSkeleton rows={4} label="Loading tools" />
              ) : rows.length === 0 ? (
                <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
                  No tagged tools match.
                </p>
              ) : (
                <div className="bg-card divide-y rounded-lg border">
                  <label className="text-muted-foreground flex items-center gap-3 px-3 py-2 text-xs">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    />
                    {rows.length} tool{rows.length === 1 ? "" : "s"}
                    {rows.length >= 500 ? " (showing first 500)" : ""}
                  </label>
                  {rows.map((tool) => (
                    <div key={tool.id} className="hover:bg-accent flex items-center gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0"
                        checked={selected.has(tool.id)}
                        onChange={() => toggle(tool.id)}
                        aria-label={`Select ${tool.assetTag}`}
                      />
                      <div className="min-w-0 flex-1">
                        <Link href={`/dashboard/assets/tools/${tool.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 hover:underline">
                          <span className="font-mono text-xs font-semibold">{tool.assetTag}</span>
                          <span className="font-medium">{tool.name}</span>
                          <ToolStatusBadge status={tool.status} />
                        </Link>
                        <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs sm:text-sm">
                          <HolderLink holder={{ type: tool.holderType as HolderRef["type"], id: tool.holderId }} label={tool.holder.label} kind={tool.holder.kind} />
                          {tool.serialNumber && <span>S/N {tool.serialNumber}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <MoveDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        assetIds={[...selected]}
        canManage={canManage}
        onDone={() => setSelected(new Set())}
      />
      <AddToolsDialog open={addOpen} onOpenChange={setAddOpen} initialPartId={partId} />
    </AssetsShell>
  );
}
