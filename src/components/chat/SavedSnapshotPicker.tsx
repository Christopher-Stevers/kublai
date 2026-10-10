"use client";
import { useEffect, useState } from "react";
import { CameraIcon, PencilIcon } from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { snapshotEditHref } from "~/lib/snapshot-edit";

export function SavedSnapshotPicker({
  onCapture,
  onEdit,
}: {
  onCapture: () => void;
  onEdit: (href: string) => void;
}) {
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
  const saved = api.conversations.savedSnapshots.useQuery({
    search: query,
    beforeSequence: cursors.at(-1),
  });
  return (
    <div className="space-y-4">
      <Button className="w-full" onClick={onCapture}>
        <CameraIcon className="size-4" /> New snapshot
      </Button>
      <input
        type="search"
        aria-label="Search saved snapshots"
        placeholder="Search drawing, caption or conversation…"
        maxLength={200}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="bg-background w-full rounded-md border px-3 py-2 text-base"
      />
      {saved.isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          Loading your snapshots…
        </p>
      ) : saved.error ? (
        <div className="space-y-2">
          <p role="alert" className="text-destructive text-sm">
            {saved.error.message}
          </p>
          <Button variant="outline" onClick={() => void saved.refetch()}>
            Try again
          </Button>
        </div>
      ) : !saved.data?.snapshots.length ? (
        <p className="text-muted-foreground text-sm">
          {query
            ? "No snapshots match your search."
            : "Snapshots you send in chat will appear here."}
        </p>
      ) : (
        <div className="max-h-[45dvh] overflow-y-auto rounded-md border">
          {saved.data.snapshots.map((snapshot) => (
            <button
              key={snapshot.id}
              type="button"
              onClick={() => onEdit(snapshotEditHref(snapshot))}
              className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-3 border-b p-3 text-left last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset"
            >
              <img
                alt=""
                src={snapshot.imageUrl}
                loading="lazy"
                className="bg-muted h-16 w-20 shrink-0 rounded border object-contain"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {snapshot.source?.title ??
                    (snapshot.body.trim() ? snapshot.body : "Snapshot")}
                </span>
                {snapshot.source?.title && (
                  <span className="text-muted-foreground block truncate text-xs">
                    {snapshot.body}
                  </span>
                )}
                <span className="text-muted-foreground block text-xs">
                  {snapshot.conversationName || "Direct conversation"} ·{" "}
                  {snapshot.createdAt.toLocaleDateString()}
                </span>
              </span>
              <PencilIcon className="size-4 shrink-0" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      {(cursors.length > 0 || saved.data?.nextCursor) && (
        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            disabled={
              !cursors.length || saved.isFetching || search.trim() !== query
            }
            onClick={() => setCursors((values) => values.slice(0, -1))}
          >
            Newer
          </Button>
          <Button
            variant="outline"
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
  );
}
