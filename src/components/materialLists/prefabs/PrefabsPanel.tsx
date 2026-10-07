"use client";

import { useState } from "react";
import {
  ArrowLeftIcon,
  BoxesIcon,
  MinusIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { confirmAction, notify } from "~/components/ui/app-dialogs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { ReplicacheMaterialListItem } from "~/hooks/use-replicache-material-list";
import { useWorkspaceMutations } from "~/hooks/use-workspace-mutations";
import { planPrefabAdd, prefabItemsFromList } from "~/lib/prefab-add";
import { api, type RouterOutputs } from "~/trpc/react";

export type Prefab = RouterOutputs["prefabs"]["list"][number];
export type PrefabView = { kind: "list" } | { kind: "edit"; prefabId: string };

function partCount(prefab: Prefab) {
  return `${prefab.items.length} part${prefab.items.length === 1 ? "" : "s"}`;
}

/**
 * Prefabs inside Add Parts: pick one and a multiplier to add all its parts to
 * this list, or build and edit prefabs. Adding goes through the list's normal
 * offline mutations, so it works without a connection once prefabs are loaded.
 */
export function PrefabsPanel({
  materialListId,
  listItems,
  view,
  onViewChange,
  onAddParts,
  onAdded,
  isOnline,
  addedBy,
}: {
  materialListId: string;
  listItems: ReplicacheMaterialListItem[];
  view: PrefabView;
  onViewChange: (view: PrefabView | null) => void;
  /** Opens the part picker to add parts to this prefab. */
  onAddParts: (prefab: { id: string; name: string }) => void;
  onAdded: () => void;
  isOnline: boolean;
  addedBy: { id: string; name: string | null; email: string | null } | null;
}) {
  const utils = api.useUtils();
  const { data: prefabs, isLoading } = api.prefabs.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const { data: role } = api.user.getMyRole.useQuery(undefined, { enabled: isOnline });
  const canEdit = isOnline && (role?.permissions.can["lists.edit"] ?? false);
  const { getReplicache, requestSync, saveQuantity } = useWorkspaceMutations();
  const refresh = () => utils.prefabs.list.invalidate();
  const onError = (error: { message: string }) => notify(error.message, "error");
  const create = api.prefabs.create.useMutation({ onError });
  const rename = api.prefabs.rename.useMutation({ onSuccess: refresh, onError });
  const remove = api.prefabs.delete.useMutation({ onSuccess: refresh, onError });
  const setQuantity = api.prefabs.setItemQuantity.useMutation({ onSuccess: refresh, onError });
  const removeItem = api.prefabs.removeItem.useMutation({ onSuccess: refresh, onError });

  const [adding, setAdding] = useState<{ prefabId: string; multiplier: number } | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [naming, setNaming] = useState<"new" | "save" | null>(null);

  const addToList = async (prefab: Prefab, multiplier: number) => {
    setIsAdding(true);
    try {
      const plan = planPrefabAdd(
        prefab.items.map((item) => ({
          ...item,
          partDefinitionId: item.partDefinition.id,
          supplierPartId: item.supplierPartId,
        })),
        listItems,
        multiplier,
      );
      const replicache = getReplicache();
      await Promise.all([
        ...plan.updates.map((update) =>
          saveQuantity({ materialListId, itemId: update.itemId, quantity: update.quantity }),
        ),
        ...plan.adds.map((line) =>
          replicache.mutate.addItem({
            materialListId,
            itemId: crypto.randomUUID(),
            partDefinitionId: line.partDefinitionId,
            supplierPartId: line.supplierPartId,
            supplierId: line.supplierPart?.supplierId ?? null,
            quantity: line.quantity,
            unitCost: line.supplierPart?.lastKnownUnitCost
              ? Number.parseFloat(line.supplierPart.lastKnownUnitCost)
              : 0,
            partDefinitionSnapshot: {
              id: line.partDefinition.id,
              displayName: line.partDefinition.displayName,
              imageUrl: line.partDefinition.imageUrl,
              material: null,
            },
            supplierPartSnapshot: line.supplierPart,
            addedBySnapshot: addedBy,
          }),
        ),
      ]);
      requestSync(0, "push-pull");
      notify(
        `Added ${prefab.name}${multiplier === 1 ? "" : ` ×${multiplier}`}`,
        "success",
        3000,
      );
      onAdded();
    } catch (error) {
      console.error("Adding prefab failed", error);
      notify("Couldn't add the prefab. Try again.", "error");
    } finally {
      setIsAdding(false);
    }
  };

  const createPrefab = async (name: string, fromList: boolean) => {
    const items = fromList ? prefabItemsFromList(listItems) : [];
    const prefab = await create.mutateAsync({ name, items }).catch(() => null);
    if (!prefab) return;
    setNaming(null);
    await refresh();
    if (fromList) {
      notify(`Saved this list as ${prefab.name}`, "success", 3000);
      onViewChange({ kind: "list" });
    } else {
      onViewChange({ kind: "edit", prefabId: prefab.id });
    }
  };

  const deletePrefab = async (prefab: Prefab) => {
    const ok = await confirmAction({
      title: `Delete ${prefab.name}?`,
      description: "This removes the prefab for everyone. Lists it was added to keep their parts.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await remove.mutateAsync({ prefabId: prefab.id }).catch(() => null);
    onViewChange({ kind: "list" });
  };

  if (view.kind === "edit") {
    const prefab = prefabs?.find((candidate) => candidate.id === view.prefabId);
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label="Back to prefabs"
            onClick={() => onViewChange({ kind: "list" })}
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
          {prefab ? (
            <Input
              key={prefab.id + prefab.name}
              defaultValue={prefab.name}
              aria-label="Prefab name"
              disabled={!canEdit}
              autoCorrect="off"
              className="h-9 text-base font-semibold"
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              onBlur={(event) => {
                const name = event.currentTarget.value.trim();
                if (name && name !== prefab.name)
                  rename.mutate({ prefabId: prefab.id, name });
                else event.currentTarget.value = prefab.name;
              }}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {isLoading ? "Loading…" : "This prefab no longer exists."}
            </p>
          )}
        </div>

        {prefab && (
          <>
            {prefab.items.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center">
                <p className="text-muted-foreground mb-3 text-sm">No parts in this prefab yet</p>
                {canEdit && (
                  <Button onClick={() => onAddParts({ id: prefab.id, name: prefab.name })}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    Add Parts
                  </Button>
                )}
              </div>
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {prefab.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.partDefinition.displayName}
                      </p>
                      <p
                        className={`truncate text-xs ${item.supplierPart ? "text-muted-foreground" : "text-amber-700"}`}
                      >
                        {item.supplierPart?.supplier.name || "No supplier"}
                      </p>
                    </div>
                    {canEdit ? (
                      <>
                        <PrefabQuantity
                          quantity={item.quantity}
                          onChange={(quantity) =>
                            setQuantity.mutate({ prefabId: prefab.id, itemId: item.id, quantity })
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground h-8 w-8 shrink-0"
                          aria-label={`Remove ${item.partDefinition.displayName}`}
                          onClick={() => removeItem.mutate({ prefabId: prefab.id, itemId: item.id })}
                        >
                          <Trash2Icon className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <span className="text-sm font-semibold tabular-nums">×{item.quantity}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="sticky bottom-0 -mx-1 space-y-2 bg-background px-1 pt-1 pb-1">
            <div className="grid grid-cols-2 gap-2">
              {canEdit && prefab.items.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => onAddParts({ id: prefab.id, name: prefab.name })}
                >
                  <PlusIcon className="mr-2 h-4 w-4" />
                  Add Parts
                </Button>
              )}
              {prefab.items.length > 0 && (
                <Button
                  className={canEdit ? "" : "col-span-2"}
                  onClick={() => setAdding({ prefabId: prefab.id, multiplier: 1 })}
                >
                  Add to List
                </Button>
              )}
            </div>
            {adding?.prefabId === prefab.id && (
              <MultiplierRow
                prefab={prefab}
                multiplier={adding.multiplier}
                busy={isAdding}
                onMultiplierChange={(multiplier) => setAdding({ prefabId: prefab.id, multiplier })}
                onCancel={() => setAdding(null)}
                onConfirm={() => void addToList(prefab, adding.multiplier)}
              />
            )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <Button variant="ghost" size="sm" className="-ml-2 h-9" onClick={() => onViewChange(null)}>
        <ArrowLeftIcon className="mr-1.5 h-4 w-4" />
        Catalogs
      </Button>

      {isLoading ? (
        <p className="text-muted-foreground px-1 text-sm">Loading prefabs…</p>
      ) : !prefabs?.length ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center">
          <BoxesIcon className="text-muted-foreground mx-auto mb-2 h-8 w-8" />
          <p className="text-sm font-medium">No prefabs yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Make a set of parts once, like a whole room, and add it to any list.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {prefabs.map((prefab) => (
            <li key={prefab.id} className="rounded-lg border bg-card">
              <div className="flex items-center gap-2 py-2 pr-1 pl-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onViewChange({ kind: "edit", prefabId: prefab.id })}
                >
                  <p className="truncate font-medium">{prefab.name}</p>
                  <p className="text-muted-foreground text-xs">{partCount(prefab)}</p>
                </button>
                <Button
                  size="sm"
                  disabled={prefab.items.length === 0}
                  onClick={() =>
                    setAdding(
                      adding?.prefabId === prefab.id
                        ? null
                        : { prefabId: prefab.id, multiplier: 1 },
                    )
                  }
                >
                  <PlusIcon className="mr-1 h-4 w-4" />
                  Add
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      aria-label={`More for ${prefab.name}`}
                    >
                      <MoreVerticalIcon className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => onViewChange({ kind: "edit", prefabId: prefab.id })}
                    >
                      <PencilIcon className="mr-2 h-4 w-4" />
                      {canEdit ? "Edit prefab" : "View parts"}
                    </DropdownMenuItem>
                    {canEdit && (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => void deletePrefab(prefab)}
                      >
                        <Trash2Icon className="mr-2 h-4 w-4" />
                        Delete prefab
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {adding?.prefabId === prefab.id && (
                <div className="border-t p-2">
                  <MultiplierRow
                    prefab={prefab}
                    multiplier={adding.multiplier}
                    busy={isAdding}
                    onMultiplierChange={(multiplier) =>
                      setAdding({ prefabId: prefab.id, multiplier })
                    }
                    onCancel={() => setAdding(null)}
                    onConfirm={() => void addToList(prefab, adding.multiplier)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit &&
        (naming ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const name = new FormData(event.currentTarget).get("name")?.toString().trim();
              if (name) void createPrefab(name, naming === "save");
            }}
          >
            <Input
              name="name"
              autoFocus
              autoCorrect="off"
              maxLength={255}
              placeholder={naming === "save" ? "Name for this list's prefab" : "Prefab name, e.g. Bathroom rough-in"}
              className="h-10"
            />
            <Button type="submit" className="h-10" disabled={create.isPending}>
              {create.isPending ? "Saving…" : naming === "save" ? "Save" : "Create"}
            </Button>
            <Button type="button" variant="ghost" className="h-10" onClick={() => setNaming(null)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setNaming("new")}>
              <PlusIcon className="mr-2 h-4 w-4" />
              New Prefab
            </Button>
            <Button
              variant="outline"
              disabled={!listItems.some((item) => item.partDefinitionId)}
              onClick={() => setNaming("save")}
            >
              <SaveIcon className="mr-2 h-4 w-4" />
              Save List as Prefab
            </Button>
          </div>
        ))}
      {!isOnline && (
        <p className="text-muted-foreground text-xs">
          Offline: you can add prefabs loaded earlier. Making or editing prefabs needs a connection.
        </p>
      )}
    </div>
  );
}

function MultiplierRow({
  prefab,
  multiplier,
  busy,
  onMultiplierChange,
  onCancel,
  onConfirm,
}: {
  prefab: Prefab;
  multiplier: number;
  busy: boolean;
  onMultiplierChange: (multiplier: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 p-2">
      <span className="text-sm font-medium">How many?</span>
      <PrefabQuantity quantity={multiplier} onChange={onMultiplierChange} live />
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={onConfirm} disabled={busy}>
          {busy ? "Adding…" : `Add ${partCount(prefab)}${multiplier === 1 ? "" : ` ×${multiplier}`}`}
        </Button>
      </div>
    </div>
  );
}

/**
 * Minus / number / plus. `live` reports every change (the multiplier);
 * otherwise typing saves once on blur or Enter (prefab part quantities).
 */
function PrefabQuantity({
  quantity,
  onChange,
  live = false,
}: {
  quantity: number;
  onChange: (quantity: number) => void;
  live?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (value: number) => {
    setDraft(null);
    if (Number.isFinite(value) && value > 0 && value !== quantity) onChange(value);
  };
  const step = (delta: number) => commit(Math.max(1, Math.floor(quantity) + delta));
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label="Less"
        disabled={quantity <= 1}
        onClick={() => step(-1)}
      >
        <MinusIcon className="h-3.5 w-3.5" />
      </Button>
      <Input
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        aria-label="Quantity"
        value={draft ?? String(quantity)}
        onChange={(event) => {
          setDraft(event.target.value);
          if (live) {
            const value = Number(event.target.value);
            if (value > 0) onChange(value);
          }
        }}
        onBlur={() => draft !== null && commit(Number(draft))}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="h-8 w-14 [appearance:textfield] px-1 text-center text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label="More"
        onClick={() => step(1)}
      >
        <PlusIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
