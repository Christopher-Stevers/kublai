"use client";

import { CheckIcon, FolderIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

/**
 * Rooms uses drawings already in the Drawings card instead of its own uploads.
 * A chosen sheet becomes a floor that shares the stored drawing.
 */
export function RoomDrawingPicker({
  jobId,
  open,
  onOpenChange,
  onAdded,
  onOpenDrawings,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (floorIds: string[]) => void;
  onOpenDrawings: () => void;
}) {
  const utils = api.useUtils();
  const choices = api.rooms.drawingChoices.useQuery(
    { jobId },
    { enabled: open, staleTime: 0 },
  );
  const add = api.rooms.addFloorsFromDrawings.useMutation();
  const [chosen, setChosen] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const sets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (choices.data?.sets ?? [])
      .map((set) => ({
        ...set,
        sheets: term
          ? set.sheets.filter(
              (sheet) =>
                sheet.name.toLowerCase().includes(term) ||
                set.name.toLowerCase().includes(term),
            )
          : set.sheets,
      }))
      .filter((set) => set.sheets.length > 0);
  }, [choices.data, search]);
  const total = (choices.data?.sets ?? []).reduce(
    (sum, set) => sum + set.sheets.length,
    0,
  );
  const toggle = (ids: string[], on: boolean) =>
    setChosen((current) =>
      on
        ? [...current, ...ids.filter((id) => !current.includes(id))]
        : current.filter((id) => !ids.includes(id)),
    );
  const close = (next: boolean) => {
    if (add.isPending) return;
    if (!next) {
      setChosen([]);
      setSearch("");
      add.reset();
    }
    onOpenChange(next);
  };
  const submit = async () => {
    // Folder order, not click order, so floors list like the drawings.
    const order = (choices.data?.sets ?? []).flatMap((set) =>
      set.sheets.map((sheet) => sheet.id),
    );
    const sheetIds = order.filter((id) => chosen.includes(id));
    const result = await add.mutateAsync({ jobId, sheetIds });
    await Promise.all([
      utils.rooms.getJobRooms.invalidate({ jobId }),
      utils.rooms.drawingChoices.invalidate({ jobId }),
    ]);
    setChosen([]);
    setSearch("");
    onOpenChange(false);
    onAdded(result.floorIds);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-4 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Choose drawings for Rooms</DialogTitle>
          <DialogDescription>
            Pick the floor plans to find rooms on. They stay in Drawings; Rooms
            uses the same copy, so nothing is uploaded again.
          </DialogDescription>
        </DialogHeader>
        {choices.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="aspect-[4/3] w-full" />
            ))}
          </div>
        ) : choices.error ? (
          <p className="text-sm text-red-600">{choices.error.message}</p>
        ) : total === 0 ? (
          <div className="space-y-3 rounded-lg border border-dashed p-6 text-center">
            <p className="font-medium">No drawings to choose from yet</p>
            <p className="text-muted-foreground text-sm">
              Upload the architectural PDF in Drawings, then come back here to
              choose its floor plans.
            </p>
            <Button
              onClick={() => {
                close(false);
                onOpenDrawings();
              }}
            >
              Go to Drawings
            </Button>
          </div>
        ) : (
          <>
            {total > 8 ? (
              <div className="relative">
                <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search drawings"
                  aria-label="Search drawings"
                  className="pl-9"
                />
              </div>
            ) : null}
            <div className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
              {sets.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  No drawings match “{search.trim()}”.
                </p>
              ) : null}
              {sets.map((set) => {
                const free = set.sheets
                  .filter((sheet) => !sheet.floorId)
                  .map((sheet) => sheet.id);
                const allOn =
                  free.length > 0 && free.every((id) => chosen.includes(id));
                return (
                  <section key={set.id} aria-label={set.name}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        <FolderIcon className="text-muted-foreground h-4 w-4 shrink-0" />
                        <span className="truncate">{set.name}</span>
                      </h3>
                      {free.length > 1 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggle(free, !allOn)}
                        >
                          {allOn ? "Clear" : "Select all"}
                        </Button>
                      ) : null}
                    </div>
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {set.sheets.map((sheet) => {
                        const used = Boolean(sheet.floorId);
                        const on = chosen.includes(sheet.id);
                        return (
                          <li key={sheet.id}>
                            <button
                              type="button"
                              aria-pressed={used ? undefined : on}
                              disabled={used}
                              onClick={() => toggle([sheet.id], !on)}
                              className={cn(
                                "group bg-card relative block w-full overflow-hidden rounded-lg border text-left transition",
                                on
                                  ? "border-primary ring-primary ring-2"
                                  : "hover:border-foreground/30",
                                used && "cursor-default opacity-60",
                              )}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`${sheet.imageUrl}?thumb=1`}
                                alt=""
                                loading="lazy"
                                className="bg-muted aspect-[4/3] w-full object-contain"
                              />
                              <span
                                className={cn(
                                  "absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-white/90 dark:bg-zinc-900/90",
                                  on
                                    ? "border-primary bg-primary text-primary-foreground dark:bg-primary"
                                    : "border-zinc-300",
                                  used && "hidden",
                                )}
                                aria-hidden="true"
                              >
                                {on ? <CheckIcon className="h-4 w-4" /> : null}
                              </span>
                              <span className="block border-t px-2.5 py-2">
                                <span className="line-clamp-2 text-sm leading-tight font-medium break-words">
                                  {sheet.name}
                                </span>
                                {used ? (
                                  <span className="text-muted-foreground mt-0.5 block text-xs">
                                    Already in Rooms
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        )}
        {add.error ? (
          <p className="text-sm text-red-600">{add.error.message}</p>
        ) : null}
        {total > 0 ? (
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {chosen.length
                ? `${chosen.length} selected. Rooms are found automatically after adding.`
                : "Select one or more floor plans."}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                disabled={!chosen.length || add.isPending}
                onClick={() => void submit()}
              >
                {add.isPending
                  ? "Adding…"
                  : chosen.length
                    ? `Add ${chosen.length} ${chosen.length === 1 ? "drawing" : "drawings"}`
                    : "Add drawings"}
              </Button>
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
