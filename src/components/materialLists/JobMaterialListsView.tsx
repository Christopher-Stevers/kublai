"use client";
import { PriorityActionBar } from "~/components/ui/priority-action-bar";
import Link from "next/link";
import { useState, type ComponentProps } from "react";
import { PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { Input } from "~/components/ui/input";
import { matchesMaterialListPart } from "~/lib/material-list-part-search";
import { usePageViewState } from "~/hooks/use-page-view-state";
import { MaterialListCard } from "~/components/materialLists/MaterialListCard";
import { ScanSlipButton } from "~/components/materialLists/ScanSlipButton";
import { useCardMerge } from "~/components/materialLists/use-card-merge";
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
  partSearchTexts?: string[];
};

/** A job's material lists, shared by the Jobs workspace and the job's
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
  const [search, setSearch] = usePageViewState(
    `material-list-part-search:${jobId}`,
    "",
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const filteredLists = lists?.filter((list) =>
    matchesMaterialListPart(list.partSearchTexts, search),
  );
  const sandbox = useTutorialSandbox();
  const online = useOnlineStatus();
  const { getReplicache, mutateAndSync, requestSync } = useWorkspaceMutations();
  const utils = api.useUtils();
  const { data: userData } = api.user.getMyRole.useQuery(undefined, {
    enabled: online,
  });
  const can = userData?.permissions.can;
  const canEdit = !sandbox && (can?.["lists.edit"] ?? false);
  const canCreate = !!sandbox || canEdit;
  const canDelete = !sandbox && (can?.["lists.delete"] ?? false);
  const canReceive = !sandbox && online && (can?.["orders.receive"] ?? false);
  const [toDelete, setToDelete] = useState<{
    id: string;
    name: string;
    itemCount?: number | null;
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
    disabled:
      !canEdit || !canDelete || !online || pending || duplicate.isPending,
    onMerged: refresh,
  });
  const busy = !online || pending || duplicate.isPending || merge.isPending;

  const create = () => {
    if (!canCreate) return;
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
      <PageHeader level="section" title="Material Lists" />
      {canReceive && <Link href={`/jobs/${jobId}/receiving`} className="mb-4 inline-flex py-2 text-sm underline">Receiving review queue</Link>}

      {search.trim() && lists && (
        <p role="status" className="text-muted-foreground mb-4 text-sm">
          {filteredLists?.length ?? 0} of {lists.length} lists contain “
          {search.trim()}”
        </p>
      )}
      {merge.banner}
      {!lists?.length ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              art="clipboard"
              title={
                !canCreate
                  ? "No material lists yet."
                  : online
                    ? "No material lists yet. Start one for this job."
                    : "No material lists yet. New lists sync when you’re online."
              }
              action={
                canCreate && (
                  <Button data-tutorial="create-list" onClick={create}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    New Material List
                  </Button>
                )
              }
            />
          </CardContent>
        </Card>
      ) : !filteredLists?.length ? (
        <p className="text-muted-foreground py-12 text-center">
          No material lists contain a matching part.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredLists.map((list) => (
            <MaterialListCard
              key={list.id}
              list={list}
              merge={merge}
              canEdit={canEdit}
              canDelete={canDelete}
              actionsBusy={busy}
              onOpen={() => onOpen(list.id)}
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

      <>
        <div
          aria-hidden="true"
          className={searchOpen || search ? "h-36" : "h-20"}
        />
        <div
          aria-label="Material list actions"
          className="bg-background pin-viewport-bottom fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-6"
        >
          {(searchOpen || search) && (
            <div className="mx-auto mb-2 flex max-w-6xl items-center gap-2">
              <Input
                autoFocus
                type="search"
                aria-label="Search parts in material lists"
                placeholder="Part name or SKU…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearch("");
                    setSearchOpen(false);
                  }
                }}
                className="h-11 text-base"
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Clear part search"
                onClick={() => {
                  setSearch("");
                  setSearchOpen(false);
                }}
              >
                <XIcon className="h-5 w-5" />
              </Button>
            </div>
          )}
          <PriorityActionBar className="mx-auto max-w-6xl gap-2" moreButtonClassName="h-12">
            <Button
              variant="outline"
              className="h-12 w-full px-2"
              aria-expanded={searchOpen || !!search}
              onClick={() => {
                if (searchOpen || search) {
                  setSearch("");
                  setSearchOpen(false);
                } else setSearchOpen(true);
              }}
            >
              <SearchIcon className="mr-2 h-5 w-5" />
              Search
            </Button>
            {canReceive && (
              <ScanSlipButton jobId={jobId} className="h-12 w-full px-2" />
            )}
            {canCreate && (
              <Button
                data-tutorial="create-list"
                onClick={create}
                size="lg"
                className="h-12 w-full px-2"
              >
                <PlusIcon className="mr-2 h-5 w-5" />
                New List
              </Button>
            )}
          </PriorityActionBar>
        </div>
      </>

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
    </>
  );
}
