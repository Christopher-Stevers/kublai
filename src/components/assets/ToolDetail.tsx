"use client";

import { useEffect, useState } from "react";
import { AlertTriangleIcon, ArrowRightLeftIcon, CheckCircle2Icon, PencilIcon, PrinterIcon } from "lucide-react";

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
import { confirmAction } from "~/components/ui/app-dialogs";
import { api } from "~/trpc/react";

import { MoveDialog, ReportProblemDialog } from "./AssetDialogs";
import {
  AssetsShell,
  ErrorText,
  HolderLink,
  ToolStatusBadge,
  describeMovement,
  formatWhen,
  useIsOnline,
  type HolderRef,
} from "./shared";

export function ToolDetail({ id, tag }: { id?: string; tag?: string }) {
  const isOnline = useIsOnline();
  const utils = api.useUtils();
  const query = api.assets.getAsset.useQuery(id ? { id } : { tag }, { enabled: isOnline, retry: false });
  const [moveOpen, setMoveOpen] = useState(false);
  const [problemOpen, setProblemOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const resolve = api.assets.resolveProblem.useMutation({ onSuccess: () => utils.assets.invalidate() });

  const tool = query.data;
  const holder: HolderRef | null = tool ? { type: tool.holderType as HolderRef["type"], id: tool.holderId } : null;
  const canManage = tool?.canManageAssets ?? false;
  const hasProblem = tool?.status === "damaged" || tool?.status === "missing";

  return (
    <AssetsShell title={tool ? tool.name : tag ? `Tool ${tag}` : "Tool"}>
      {query.isLoading ? (
        <ListPageSkeleton rows={3} label="Loading tool" />
      ) : query.error || !tool || !holder ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">{query.error?.message ?? "Tool not found."}</p>
          {tag && <p className="text-muted-foreground mt-1 text-sm">No tool in your company has the tag {tag}.</p>}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5">
            <div className="bg-card flex gap-4 rounded-lg border p-4">
              {tool.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tool.imageUrl} alt="" className="h-24 w-24 shrink-0 rounded-md border object-contain" />
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-muted rounded px-2 py-0.5 font-mono text-sm font-semibold">{tool.assetTag}</span>
                  <ToolStatusBadge status={tool.status} />
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Where: </span>
                  <HolderLink holder={holder} label={tool.holder.label} kind={tool.holder.kind} />
                </div>
                {tool.serialNumber && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Serial: </span>
                    <span className="font-mono">{tool.serialNumber}</span>
                  </div>
                )}
                {tool.notes && <p className="text-muted-foreground text-sm whitespace-pre-wrap">{tool.notes}</p>}
              </div>
            </div>

            <section className="space-y-2">
              <h3 className="font-semibold">History</h3>
              <ol className="bg-card divide-y rounded-lg border">
                {tool.history.map((h) => (
                  <li key={h.id} className="p-3 text-sm">
                    <div className="font-medium">{describeMovement(h)}</div>
                    <div className="text-muted-foreground text-xs">
                      {formatWhen(h.createdAt)}
                      {h.by ? ` · ${h.by}` : ""}
                    </div>
                    {h.note && <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">{h.note}</p>}
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside className="space-y-2">
            {tool.status !== "retired" && (holder.type !== "location" || canManage) && (
              <Button className="w-full justify-start" onClick={() => setMoveOpen(true)}>
                <ArrowRightLeftIcon className="mr-2 h-4 w-4" /> Move / hand off
              </Button>
            )}
            {tool.status !== "retired" && !hasProblem && (
              <Button variant="outline" className="w-full justify-start" onClick={() => setProblemOpen(true)}>
                <AlertTriangleIcon className="mr-2 h-4 w-4" /> Report damaged or missing
              </Button>
            )}
            {canManage && hasProblem && (
              <>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ assetId: tool.id, outcome: "in_service", note: tool.status === "damaged" ? "Repaired" : "Found" })}
                >
                  <CheckCircle2Icon className="mr-2 h-4 w-4" />
                  {tool.status === "damaged" ? "Repaired: back in service" : "Found: back in service"}
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start text-red-700"
                  disabled={resolve.isPending}
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: `Retire ${tool.assetTag}?`,
                      description: "Retired tools stay in the history but can't be requested or moved.",
                      confirmLabel: "Retire",
                      destructive: true,
                    });
                    if (ok) resolve.mutate({ assetId: tool.id, outcome: "retired", note: "Retired" });
                  }}
                >
                  Retire (write off)
                </Button>
              </>
            )}
            {canManage && (
              <Button variant="outline" className="w-full justify-start" onClick={() => setEditOpen(true)}>
                <PencilIcon className="mr-2 h-4 w-4" /> Edit tag, serial, notes
              </Button>
            )}
            <Button variant="outline" className="w-full justify-start" asChild>
              <a href={`/dashboard/assets/labels?ids=${tool.id}`} target="_blank" rel="noreferrer">
                <PrinterIcon className="mr-2 h-4 w-4" /> Print QR label
              </a>
            </Button>
            <ErrorText message={resolve.error?.message} />
          </aside>

          <MoveDialog open={moveOpen} onOpenChange={setMoveOpen} assetIds={[tool.id]} from={holder} canManage={canManage} />
          <ReportProblemDialog open={problemOpen} onOpenChange={setProblemOpen} assetId={tool.id} toolLabel={`${tool.name} · ${tool.assetTag}`} />
          <EditToolDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            tool={{ id: tool.id, assetTag: tool.assetTag, serialNumber: tool.serialNumber, notes: tool.notes }}
          />
        </div>
      )}
    </AssetsShell>
  );
}

function EditToolDialog({
  open,
  onOpenChange,
  tool,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool: { id: string; assetTag: string; serialNumber: string | null; notes: string | null };
}) {
  const utils = api.useUtils();
  const [assetTag, setAssetTag] = useState(tool.assetTag);
  const [serialNumber, setSerialNumber] = useState(tool.serialNumber ?? "");
  const [notes, setNotes] = useState(tool.notes ?? "");
  const update = api.assets.updateAsset.useMutation({
    onSuccess: async () => {
      await utils.assets.invalidate();
      onOpenChange(false);
    },
  });
  useEffect(() => {
    if (!open) return;
    setAssetTag(tool.assetTag);
    setSerialNumber(tool.serialNumber ?? "");
    setNotes(tool.notes ?? "");
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit tool</DialogTitle>
          <DialogDescription>Changing the tag means printing a new label.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-tag">Tag</Label>
            <Input id="edit-tag" value={assetTag} onChange={(event) => setAssetTag(event.target.value.toUpperCase())} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-serial">Serial number</Label>
            <Input id="edit-serial" value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea id="edit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
          <ErrorText message={update.error?.message} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!assetTag.trim() || update.isPending}
            onClick={() =>
              update.mutate({
                id: tool.id,
                assetTag: assetTag.trim(),
                serialNumber: serialNumber.trim() || null,
                notes: notes.trim() || null,
              })
            }
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
