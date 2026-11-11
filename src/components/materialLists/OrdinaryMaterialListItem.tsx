"use client";
import { useRef } from "react";
import type { MaterialListItemProps } from "./MaterialListItem";
import {
  InitialsSyncBadge,
  MaterialListPartPhoto,
  MaterialListRowMenu,
  MaterialListEditableFields,
} from "./MaterialListItemPresentation";
import { Card, CardContent } from "~/components/ui/card";
import { firstText } from "~/lib/first-text";
import { useWorkspaceMutations } from "~/hooks/use-workspace-mutations";
import {
  resolveReplicacheSyncStatus,
  useReplicacheSyncing,
} from "~/hooks/use-replicache-material-list";

/** No receipt hook/state/timer/listener is mounted on the ordinary path.
 * Selection is owned by MaterialListItem's exact unsent/non-verify boundary. */
export function OrdinaryMaterialListItem({
  item,
  materialListId,
  suppliers,
  syncStatus,
  isToolRequest = false,
}: MaterialListItemProps) {
  const {
    getReplicache: getMaterialListReplicache,
    mutateAndSync: mutateMaterialListAndSync,
  } = useWorkspaceMutations();
  const removeInFlightRef = useRef(false);
  const handleRemove = () => {
    if (removeInFlightRef.current) return;
    removeInFlightRef.current = true;
    void mutateMaterialListAndSync(
      getMaterialListReplicache().mutate.removeItem({
        materialListId,
        itemId: item.id,
      }),
    );
  };
  const partName =
    firstText(item.partDefinition?.displayName, item.descriptionSnapshot) ??
    "Unknown Part";
  const isReplicacheSyncing = useReplicacheSyncing(
    !syncStatus && !!item.pendingSync,
  );
  const itemSyncStatus =
    syncStatus ??
    resolveReplicacheSyncStatus(item.pendingSync, isReplicacheSyncing);
  return (
    <Card className="group relative h-full w-full gap-0 overflow-hidden rounded-2xl py-0 shadow-sm transition-all [contain-intrinsic-size:20rem] [content-visibility:auto] hover:shadow-md">
      <CardContent className="h-full p-0">
        <div className="flex h-full w-full flex-col px-3 pt-3 pb-2">
          <InitialsSyncBadge user={item.addedBy} status={itemSyncStatus} />
          <MaterialListRowMenu
            partName={partName}
            handleRemove={handleRemove}
          />
          <MaterialListPartPhoto item={item} />
          <div className="text-foreground flex items-start justify-center text-center">
            <h3 className="line-clamp-4 text-sm leading-snug font-medium">
              {partName}
            </h3>
          </div>
          {item.roomName && (
            <p className="text-muted-foreground mt-1 text-center text-xs">
              Room: {item.roomName}
            </p>
          )}
          <MaterialListEditableFields
            item={item}
            materialListId={materialListId}
            suppliers={suppliers}
            isToolRequest={isToolRequest}
          />
        </div>
      </CardContent>
    </Card>
  );
}
