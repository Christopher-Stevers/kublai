"use client";
import { format } from "date-fns";
import {
  CopyIcon,
  MergeIcon,
  WrenchIcon,
  MoreVerticalIcon,
  TrashIcon,
  PackageIcon,
  UserIcon,
  UsersIcon,
  CalendarIcon,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "~/components/ui/dropdown-menu";
import { FinancialOnly } from "~/components/permissions/FinancialVisibility";
import { MaterialListOrderNumbers } from "./MaterialListOrderNumbers";
import type { useCardMerge } from "./use-card-merge";
import type { ReplicacheMaterialListSummary } from "~/hooks/use-replicache-jobs";

type List = Pick<
  ReplicacheMaterialListSummary,
  | "id"
  | "name"
  | "kind"
  | "itemCount"
  | "materialTotal"
  | "orderNumbers"
  | "orderStatuses"
  | "overallProgress"
  | "contributors"
  | "departments"
  | "sentSupplierCount"
  | "totalSupplierCount"
  | "verifiedSupplierCount"
> & { createdAt: string | Date };
type Props = {
  list: List;
  merge: ReturnType<typeof useCardMerge>;
  canEdit: boolean;
  canDelete: boolean;
  actionsBusy: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export function MaterialListCard({
  list,
  merge,
  canEdit,
  canDelete,
  actionsBusy,
  onOpen,
  onDuplicate,
  onDelete,
}: Props) {
  return (
    <Card
      {...merge.cardProps(list)}
      className={
        "card-lift relative cursor-pointer overflow-hidden select-none" +
        merge.cardClassName(list)
      }
      onClick={() => {
        if (merge.active) {
          merge.pick(list);
          return;
        }
        onOpen();
      }}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="line-clamp-2 min-w-0 leading-tight break-words">
            {list.kind === "tools" && (
              <WrenchIcon
                className="text-muted-foreground mr-1.5 inline h-4 w-4 align-[-2px]"
                aria-label="Tool request"
              />
            )}
            {list.name}
          </CardTitle>
          {!merge.active && (canDelete || canEdit) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground -mt-1 -mr-2 h-9 w-9 shrink-0"
                  aria-label={`More actions for ${list.name}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreVerticalIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onClick={(event) => event.stopPropagation()}
              >
                {canEdit && (
                  <>
                    <DropdownMenuItem
                      disabled={actionsBusy}
                      onSelect={() => onDuplicate()}
                    >
                      <CopyIcon className="h-4 w-4" />
                      Duplicate
                    </DropdownMenuItem>
                    {list.kind !== "tools" && (
                      <DropdownMenuItem
                        disabled={actionsBusy}
                        onSelect={() => {
                          merge.begin(list);
                        }}
                      >
                        <MergeIcon className="h-4 w-4" />
                        Merge
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                {canDelete && (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => onDelete()}
                  >
                    <TrashIcon className="h-4 w-4" />
                    Delete list
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="text-muted-foreground flex flex-1 flex-col gap-2 text-sm">
          <div className="flex items-center gap-2">
            <PackageIcon className="h-4 w-4" />
            <span>
              {list.itemCount} {list.kind === "tools" ? "tool lines" : "items"}
            </span>
          </div>

          {!!list.contributors?.length && (
            <div aria-label="Contributors by department" className="space-y-1.5">
              {contributorDepartments(list.contributors).map(group => (
                <div key={group.key} aria-label={`${group.label} contributors`} className="flex items-start gap-2 leading-snug">
                  {group.people.length > 1 ? (
                    <UsersIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <UserIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="bg-muted/40 text-foreground max-w-full rounded-full border px-2 py-0.5 text-xs font-medium break-words">{group.label}</span>
                    <span className="min-w-0 break-words">{group.people.map(formatContributorName).join(", ")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <MaterialListOrderNumbers orders={list.orderStatuses} numbers={list.orderNumbers} />
          <div className="mt-auto flex items-end justify-between gap-3 pt-1">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4" />
              <span>{format(new Date(list.createdAt), "MMM d, yyyy")}</span>
            </div>
            <FinancialOnly>
              {list.kind !== "tools" && (
                <span className="text-foreground shrink-0 font-semibold tabular-nums">
                  ${list.materialTotal.toFixed(2)}
                </span>
              )}
            </FinancialOnly>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatContributorName(contributor: {
  name: string | null;
  email: string | null;
}) {
  return contributor.name?.trim() || contributor.email?.trim() || "Unknown";
}

function contributorDepartments(people: NonNullable<List["contributors"]>) {
  const groups = new Map<string, { key: string; label: string; people: typeof people }>();
  for (const person of people) {
    const department = person.department?.trim();
    const key = department?.toLocaleLowerCase() ?? "";
    let group = groups.get(key);
    if (!group) {
      group = { key, label: department || "No department", people: [] };
      groups.set(key, group);
    }
    if (!group.people.some(existing => existing.id === person.id)) group.people.push(person);
  }
  return [...groups.values()].sort((a, b) => !a.key ? 1 : !b.key ? -1 : a.label.localeCompare(b.label));
}
