"use client";
import { useEffect, useRef } from "react";
import { format } from "date-fns";
import {
  CopyIcon,
  MergeIcon,
  WrenchIcon,
  MoreVerticalIcon,
  TrashIcon,
  PackageIcon,
  UsersIcon,
  UserIcon,
  CalendarIcon,
  SendIcon,
  CheckCircle2Icon,
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
  | "contributors"
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
  onOrders: () => void;
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
  onOrders,
  onDuplicate,
  onDelete,
}: Props) {
  const materialListPressTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const materialListPressHandled = useRef(false);
  const materialListPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const clearMaterialListPress = () => {
    if (materialListPressTimer.current)
      clearTimeout(materialListPressTimer.current);
    materialListPressTimer.current = null;
  };
  useEffect(
    () => () => {
      if (materialListPressTimer.current)
        clearTimeout(materialListPressTimer.current);
    },
    [],
  );
  return (
    <Card
      {...merge.cardProps(list)}
      className={
        "card-lift relative cursor-pointer overflow-hidden select-none" +
        merge.cardClassName(list)
      }
      onPointerDown={(event) => {
        if (merge.active || event.button !== 0) return;
        clearMaterialListPress();
        materialListPressHandled.current = false;
        materialListPressOrigin.current = {
          x: event.clientX,
          y: event.clientY,
        };
        materialListPressTimer.current = setTimeout(() => {
          materialListPressHandled.current = true;
          materialListPressTimer.current = null;
          onOrders();
        }, 550);
      }}
      onPointerMove={(event) => {
        const origin = materialListPressOrigin.current;
        if (
          origin &&
          Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10
        )
          clearMaterialListPress();
      }}
      onPointerUp={clearMaterialListPress}
      onPointerLeave={clearMaterialListPress}
      onPointerCancel={clearMaterialListPress}
      onContextMenu={(event) => {
        event.preventDefault();
        clearMaterialListPress();
        if (merge.active) return;
        materialListPressHandled.current = true;
        onOrders();
      }}
      onClick={(event) => {
        clearMaterialListPress();
        if (merge.active) {
          merge.pick(list);
          return;
        }
        if (materialListPressHandled.current) {
          event.preventDefault();
          materialListPressHandled.current = false;
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
                  onPointerDown={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}
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
        <MaterialListOrderNumbers numbers={list.orderNumbers} />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="text-muted-foreground flex flex-1 flex-col gap-2 text-sm">
          <div className="flex items-center gap-2">
            <PackageIcon className="h-4 w-4" />
            <span>
              {list.itemCount} {list.kind === "tools" ? "tool lines" : "items"}
            </span>
          </div>

          {list.contributors && list.contributors.length > 0 && (
            <div className="flex items-start gap-2">
              {list.contributors.length > 1 ? (
                <UsersIcon className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <UserIcon className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0 leading-snug">
                {list.contributors.map(formatContributorName).join(", ")}
              </span>
            </div>
          )}
          <MaterialListSendStatus
            sentSupplierCount={list.sentSupplierCount}
            totalSupplierCount={list.totalSupplierCount}
            verifiedSupplierCount={list.verifiedSupplierCount}
          />
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

function getSendStatusTone(
  sentSupplierCount: number,
  totalSupplierCount: number,
) {
  if (totalSupplierCount === 0) {
    return {
      chip: "border-border bg-muted/50 text-muted-foreground",
      bar: "bg-gray-300",
    };
  }

  if (sentSupplierCount >= totalSupplierCount) {
    return {
      chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
      bar: "bg-emerald-500",
    };
  }

  if (sentSupplierCount > 0) {
    return {
      chip: "border-amber-200 bg-amber-50 text-amber-700",
      bar: "bg-amber-500",
    };
  }

  return {
    chip: "border-border bg-muted/50 text-foreground/80",
    bar: "bg-gray-400",
  };
}

function MaterialListSendStatus({
  sentSupplierCount = 0,
  totalSupplierCount = 0,
  verifiedSupplierCount = 0,
}: {
  sentSupplierCount?: number;
  totalSupplierCount?: number;
  verifiedSupplierCount?: number;
}) {
  const normalizedSentCount = Math.min(sentSupplierCount, totalSupplierCount);
  const normalizedVerifiedCount = Math.min(
    verifiedSupplierCount,
    normalizedSentCount,
  );
  const progress =
    totalSupplierCount > 0
      ? Math.round((normalizedSentCount / totalSupplierCount) * 100)
      : 0;
  const tone = getSendStatusTone(normalizedSentCount, totalSupplierCount);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <div
          className={
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium " +
            tone.chip
          }
        >
          <SendIcon className="h-3.5 w-3.5" />
          <span>
            {normalizedSentCount}/{totalSupplierCount} sent
          </span>
        </div>
        {normalizedSentCount > 0 && (
          <div className="border-border bg-card text-foreground/80 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium">
            <CheckCircle2Icon className="text-muted-foreground h-3.5 w-3.5" />
            <span>
              {normalizedVerifiedCount}/{normalizedSentCount} verified
            </span>
          </div>
        )}
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className={"h-full rounded-full transition-all " + tone.bar}
          style={{ width: progress + "%" }}
        />
      </div>
    </div>
  );
}

function formatContributorName(contributor: {
  name: string | null;
  email: string | null;
}) {
  return contributor.name?.trim() || contributor.email?.trim() || "Unknown";
}
