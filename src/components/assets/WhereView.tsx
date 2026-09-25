"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRightIcon, PencilIcon, PlusIcon } from "lucide-react";

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
import { Label } from "~/components/ui/label";
import { ListPageSkeleton } from "~/components/ui/skeleton";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

import { AssetsShell, ErrorText, HolderIcon, holderHref, useIsOnline, useToolRoom } from "./shared";

type Location = RouterOutputs["assets"]["holders"]["locations"][number];

function Row({ href, kind, label, sub, action }: { href: string; kind: string; label: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="hover:bg-accent flex items-center gap-2 pr-2">
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 p-3">
        <HolderIcon kind={kind} className="text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{label}</div>
          {sub && <div className="text-muted-foreground truncate text-xs">{sub}</div>}
        </div>
        <ChevronRightIcon className="text-muted-foreground h-4 w-4 shrink-0" />
      </Link>
      {action}
    </div>
  );
}

export function WhereView() {
  const isOnline = useIsOnline();
  const { canManage } = useToolRoom();
  const holders = api.assets.holders.useQuery(undefined, { enabled: isOnline });
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const data = holders.data;
  const locations = (data?.locations ?? []).filter((l) => showArchived || l.isActive);

  return (
    <AssetsShell
      title="Where tools are"
      description="Open a yard, vehicle, job or person to see what they have, move tools, or count them"
      actions={
        canManage && (
          <Button onClick={() => setEditing("new")}>
            <PlusIcon className="mr-2 h-4 w-4" /> Add location
          </Button>
        )
      }
    >
      {holders.isLoading ? (
        <ListPageSkeleton label="Loading" />
      ) : holders.error || !data ? (
        <ErrorText message={holders.error?.message ?? "Could not load."} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Yard, warehouses &amp; vehicles</h3>
              {data.locations.some((l) => !l.isActive) && (
                <button className="text-muted-foreground text-xs hover:underline" onClick={() => setShowArchived((v) => !v)}>
                  {showArchived ? "Hide archived" : "Show archived"}
                </button>
              )}
            </div>
            <div className="bg-card divide-y rounded-lg border">
              {locations.map((l) => (
                <div key={l.id} className={cn(!l.isActive && "opacity-60")}>
                  <Row
                    href={holderHref({ type: "location", id: l.id })}
                    kind={l.kind}
                    label={l.name}
                    sub={[l.kind === "vehicle" ? "Vehicle" : "Warehouse / yard", !l.isActive && "archived", l.notes].filter(Boolean).join(" · ")}
                    action={
                      canManage && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setEditing(l)} aria-label={`Edit ${l.name}`}>
                          <PencilIcon className="h-4 w-4" />
                        </Button>
                      )
                    }
                  />
                </div>
              ))}
              {locations.length === 0 && <p className="text-muted-foreground p-3 text-sm">No locations yet.</p>}
            </div>
          </section>
          <section className="space-y-2">
            <h3 className="font-semibold">Jobs</h3>
            <div className="bg-card max-h-[32rem] divide-y overflow-y-auto rounded-lg border">
              {data.jobs.map((j) => (
                <Row key={j.id} href={holderHref({ type: "job", id: j.id })} kind="job" label={j.name} sub={j.status ?? undefined} />
              ))}
            </div>
          </section>
          <section className="space-y-2">
            <h3 className="font-semibold">People</h3>
            <div className="bg-card max-h-[32rem] divide-y overflow-y-auto rounded-lg border">
              {data.people.map((p) => (
                <Row key={p.id} href={holderHref({ type: "user", id: p.id })} kind="user" label={p.id === data.me ? `${p.name} (me)` : p.name} />
              ))}
            </div>
          </section>
        </div>
      )}
      <LocationDialog location={editing} onClose={() => setEditing(null)} />
    </AssetsShell>
  );
}

function LocationDialog({ location, onClose }: { location: Location | "new" | null; onClose: () => void }) {
  const utils = api.useUtils();
  const [kind, setKind] = useState<"warehouse" | "vehicle">("warehouse");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const save = api.assets.saveLocation.useMutation({
    onSuccess: async () => {
      await utils.assets.invalidate();
      onClose();
    },
  });
  const existing = location && location !== "new" ? location : null;

  useEffect(() => {
    if (!location) return;
    setKind(existing?.kind === "vehicle" ? "vehicle" : "warehouse");
    setName(existing?.name ?? "");
    setNotes(existing?.notes ?? "");
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  return (
    <Dialog open={!!location} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit location" : "Add location"}</DialogTitle>
          <DialogDescription>Somewhere the tool room keeps tools: a yard, shop, container or truck.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(["warehouse", "vehicle"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                className={cn("rounded-md border px-3 py-1.5 text-sm", kind === option ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent")}
              >
                {option === "warehouse" ? "Yard / warehouse" : "Vehicle"}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location-name">Name</Label>
            <Input id="location-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "vehicle" ? "Truck 7" : "Main Yard"} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location-notes">Notes</Label>
            <Textarea id="location-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Address, plate, who drives it…" />
          </div>
          <ErrorText message={save.error?.message} />
        </div>
        <DialogFooter className="gap-2">
          {existing && (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={save.isPending}
              onClick={() => save.mutate({ id: existing.id, kind, name: name.trim() || existing.name, notes: notes.trim() || null, isActive: !existing.isActive })}
            >
              {existing.isActive ? "Archive" : "Restore"}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate({ id: existing?.id, kind, name: name.trim(), notes: notes.trim() || null })}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
