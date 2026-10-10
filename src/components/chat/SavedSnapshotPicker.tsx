"use client";
import { useEffect, useState } from "react";
import { CameraIcon, ChevronDownIcon, PencilIcon } from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { snapshotEditHref } from "~/lib/snapshot-edit";

/**
 * Minimal snapshot menu: New snapshot, plus a small arrow that drops down
 * your saved snapshots for editing (only fetched when opened).
 */
export function SavedSnapshotPicker({
  onCapture,
  onEdit,
}: {
  onCapture: () => void;
  onEdit: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<number[]>([]);
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setCursors([]);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, query]);
  const saved = api.conversations.savedSnapshots.useQuery(
    { search: query, beforeSequence: cursors.at(-1) },
    { enabled: open },
  );
  return (
    <div className="space-y-2">
      <Button className="w-full" onClick={onCapture}>
        <CameraIcon className="size-4" /> New snapshot
      </Button>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1 py-1 text-sm"
      >
        My snapshots
        <ChevronDownIcon
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="space-y-2">
          <input
            type="search"
            aria-label="Search saved snapshots"
            placeholder="Search"
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="bg-background h-9 w-full rounded-md border px-3 text-sm"
          />
          {saved.isPending ? (
            <p role="status" className="text-muted-foreground py-2 text-center text-sm">
              Loading…
            </p>
          ) : saved.error ? (
            <div className="space-y-2">
              <p role="alert" className="text-destructive text-sm">
                {saved.error.message}
              </p>
              <Button size="sm" variant="outline" onClick={() => void saved.refetch()}>
                Try again
              </Button>
            </div>
          ) : !saved.data?.snapshots.length ? (
            <p className="text-muted-foreground py-2 text-center text-sm">
              {query ? "No snapshots match your search." : "Snapshots you send in chat will appear here."}
            </p>
          ) : (
            <div className="max-h-[40dvh] overflow-y-auto rounded-md border">
              {saved.data.snapshots.map((snapshot) => (
                <button
                  key={snapshot.id}
                  type="button"
                  onClick={() => onEdit(snapshotEditHref(snapshot))}
                  className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-3 border-b px-2 py-1.5 text-left last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset"
                >
                  <img
                    alt=""
                    src={snapshot.imageUrl}
                    loading="lazy"
                    className="bg-muted h-10 w-12 shrink-0 rounded border object-contain"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {snapshot.source?.title ?? (snapshot.body.trim() ? snapshot.body : "Snapshot")}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {snapshot.createdAt.toLocaleDateString()}
                    </span>
                  </span>
                  <PencilIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          {(cursors.length > 0 || saved.data?.nextCursor) && (
            <div className="flex justify-between gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={!cursors.length || saved.isFetching || search.trim() !== query}
                onClick={() => setCursors((values) => values.slice(0, -1))}
              >
                Newer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!saved.data?.nextCursor || saved.isFetching || search.trim() !== query}
                onClick={() => {
                  const next = saved.data?.nextCursor;
                  if (next) setCursors((values) => [...values, next]);
                }}
              >
                Older
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
