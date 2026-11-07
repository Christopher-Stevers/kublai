"use client";
import { useEffect, useState } from "react";
import { ListIcon, PencilIcon } from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { snapshotEditHref } from "~/lib/snapshot-edit";

/** Saved snapshots popover, fetched only when the list button is opened. */
export function SavedSnapshotPicker({
  disabled = false,
  onEdit,
}: {
  disabled?: boolean;
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
    <div className="relative">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="rounded-full"
        aria-label="Saved snapshots"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <ListIcon className="size-4" aria-hidden="true" />
      </Button>
      {open && (
        <div className="bg-background/95 absolute top-full left-1/2 z-10 mt-2 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/3 space-y-2 rounded-xl border p-3 shadow-xl backdrop-blur-md">
          <p className="text-sm font-medium">Saved snapshots</p>
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
            <p
              role="status"
              className="text-muted-foreground py-2 text-center text-sm"
            >
              Loading…
            </p>
          ) : saved.error ? (
            <div className="space-y-2">
              <p role="alert" className="text-destructive text-sm">
                {saved.error.message}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void saved.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : !saved.data?.snapshots.length ? (
            <p className="text-muted-foreground py-2 text-center text-sm">
              {query
                ? "No snapshots match your search."
                : "Snapshots you send in chat will appear here."}
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
                      {snapshot.source?.title ??
                        (snapshot.body.trim() ? snapshot.body : "Snapshot")}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {snapshot.createdAt.toLocaleDateString()}
                    </span>
                  </span>
                  <PencilIcon
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          )}
          {(cursors.length > 0 || saved.data?.nextCursor) && (
            <div className="flex justify-between gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  !cursors.length || saved.isFetching || search.trim() !== query
                }
                onClick={() => setCursors((values) => values.slice(0, -1))}
              >
                Newer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  !saved.data?.nextCursor ||
                  saved.isFetching ||
                  search.trim() !== query
                }
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
