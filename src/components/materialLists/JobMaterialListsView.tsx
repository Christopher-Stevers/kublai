"use client";
import { useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { MaterialListCard } from "~/components/materialLists/MaterialListCard";
import { ScanSlipButton } from "~/components/materialLists/ScanSlipButton";
import { useCardMerge } from "~/components/materialLists/use-card-merge";
import { MaterialListOrderPickerDialog } from "~/components/materialLists/VerifyOrderButton";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { notify } from "~/components/ui/app-dialogs";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { EmptyState } from "~/components/ui/empty-state";
import { PageHeader } from "~/components/ui/page-header";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useRememberedScroll } from "~/hooks/use-remembered-scroll";
import { useWorkspaceMutations } from "~/hooks/use-workspace-mutations";
import { getNextMaterialListNameFromNames } from "~/lib/material-list-names";
import { api } from "~/trpc/react";

type List = ComponentProps<typeof MaterialListCard>["list"] & {
  pendingSync?: boolean;
};

/** A job's material lists, shared by the dashboard workspace and the job's
 * own Material Lists route. `lists` is undefined until the job has loaded;
 * `onOpen` shows a list, including one just created. */
export function JobMaterialListsView({
  jobId,
  lists,
  onOpen,
}: {
  jobId: string;
  lists: List[] | undefined;
  onOpen: (materialListId: string) => void;
}) {
  const router = useRouter();
  const sandbox = useTutorialSandbox();
  const online = useOnlineStatus();
  const { getReplicache, mutateAndSync, requestSync } = useWorkspaceMutations();
  const utils = api.useUtils();
  const { data: userData } = api.user.getMyRole.useQuery(undefined, {
    enabled: online,
  });
  const can = userData?.permissions.can;
  const canEdit = !sandbox && (can?.["lists.edit"] ?? false);
  const canDelete = !sandbox && (can?.["lists.delete"] ?? true);
  const canReceive = !sandbox && online && (can?.["orders.receive"] ?? false);
  const [toDelete, setToDelete] = useState<{
    id: string;
    name: string;
    itemCount?: number | null;
  } | null>(null);
  const [forOrders, setForOrders] = useState<{
    id: string;
    name: string;
  } | null>(null);

  useRememberedScroll(
    sandbox ? null : `material-lists:${jobId}`,
    lists !== undefined,
  );
  const refresh = () => {
    requestSync();
    void utils.job.getJob.invalidate({ jobId });
  };
  const duplicate = api.materialList.duplicate.useMutation({
    onSuccess: () => {
      refresh();
      notify("Editable copy created.", "success");
    },
    onError: (error) => notify(error.message, "error"),
  });
  const pending = lists?.some((list) => list.pendingSync) ?? false;
  const merge = useCardMerge({
    disabled: !online || pending || duplicate.isPending,
    onMerged: refresh,
  });
  const busy = !online || pending || duplicate.isPending || merge.isPending;

  const create = () => {
    const materialListId = crypto.randomUUID();
    void mutateAndSync(
      getReplicache().mutate.createMaterialList({
        materialListId,
        jobId,
        name: getNextMaterialListNameFromNames(
          lists?.map((list) => list.name) ?? [],
        ),
      }),
    );
    onOpen(materialListId);
  };
  const confirmDelete = () => {
    if (!toDelete || !canDelete) return;
    const { id } = toDelete;
    setToDelete(null);
    void mutateAndSync(
      getReplicache().mutate.deleteMaterialList({ materialListId: id }),
    );
  };

  return (
    <>
      <PageHeader
        level="section"
        title="Material Lists"
        actions={
          <div className="hidden flex-wrap items-center gap-2 sm:flex sm:justify-end">
            {canReceive && <ScanSlipButton jobId={jobId} className="h-11" />}
            <Button
              data-tutorial="create-list"
              onClick={create}
              size="lg"
              className="hidden h-11 sm:inline-flex sm:w-auto"
            >
              <PlusIcon className="mr-2 h-5 w-5" />
              New Material List
            </Button>
          </div>
        }
      />

      {merge.banner}
      {!lists?.length ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              art="clipboard"
              title={
                online
                  ? "No material lists yet. Start one for this job."
                  : "No material lists yet. New lists sync when you’re online."
              }
              action={
                <Button data-tutorial="create-list" onClick={create}>
                  <PlusIcon className="mr-2 h-4 w-4" />
                  New Material List
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => (
            <MaterialListCard
              key={list.id}
              list={list}
              merge={merge}
              canEdit={canEdit}
              canDelete={canDelete}
              actionsBusy={busy}
              onOpen={() => onOpen(list.id)}
              onOrders={() => setForOrders({ id: list.id, name: list.name })}
              onDuplicate={() => duplicate.mutate({ materialListId: list.id })}
              onDelete={() =>
                setToDelete({
                  id: list.id,
                  name: list.name,
                  itemCount: list.itemCount,
                })
              }
            />
          ))}
        </div>
      )}

      <div className="bg-background pin-viewport-bottom fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:hidden">
        <div className={canReceive ? "grid grid-cols-2 gap-2" : undefined}>
          {canReceive && (
            <ScanSlipButton jobId={jobId} className="h-12 w-full" />
          )}
          <Button
            data-tutorial="create-list"
            onClick={create}
            size="lg"
            className="h-12 w-full"
          >
            <PlusIcon className="mr-2 h-5 w-5" />
            {canReceive ? "New List" : "New Material List"}
          </Button>
        </div>
      </div>

      <Dialog
        open={!!toDelete}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete material list?</DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              {toDelete ? `"${toDelete.name}"` : "this material list"}
              {toDelete?.itemCount
                ? ` and ${toDelete.itemCount} ${
                    toDelete.itemCount === 1 ? "item" : "items"
                  }`
                : ""}
              . This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!toDelete}
              onClick={confirmDelete}
            >
              Delete Material List
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MaterialListOrderPickerDialog
        materialList={forOrders}
        open={!!forOrders}
        onOpenChange={(open) => {
          if (!open) setForOrders(null);
        }}
        onVerifyOrder={(orderId) => {
          if (forOrders)
            router.push(
              `/dashboard/material-lists/${forOrders.id}?orderId=${orderId}`,
            );
        }}
      />
    </>
  );
}
