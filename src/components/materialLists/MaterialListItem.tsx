"use client";

import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent } from "~/components/ui/card";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import { VerticalPickerOverlay } from "~/components/materialLists/wizard/VerticalPickerOverlay";
import { Button } from "~/components/ui/button";
import {
  CheckCircle2Icon,
  Clock3Icon,
  Loader2Icon,
  TrashIcon,
  XCircleIcon,
} from "lucide-react";
import Image from "next/image";
import {
  getMaterialListReplicache,
  mutateMaterialListAndSync,
} from "~/lib/replicache-material-list";
import { cn } from "~/lib/utils";
import type { ReplicacheSupplier } from "~/hooks/use-replicache-suppliers";

type MaterialListSyncStatus = "synced" | "pending" | "syncing";
type VerifyStatus = "pending" | "partial" | "complete" | "problem";

interface MaterialListItemProps {
  item: {
    id: string;
    quantity: string;
    unitCost: string | null;
    extendedPrice: string | null;
    descriptionSnapshot: string | null;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
    pendingSync?: boolean;
    partDefinition: {
      id: string;
      displayName: string;
      imageUrl: string | null;
      material: string | null;
    } | null;
    selectedSupplierId?: string | null;
    supplierPart: {
      id: string;
      supplierId: string;
      supplierSku: string | null;
      lastKnownUnitCost: string | null;
      supplier: {
        id: string;
        name: string;
      } | null;
    } | null;
    uom?: {
      id: string;
      code: string;
      displayName: string | null;
    } | null;
    addedBy?: {
      id: string;
      name: string | null;
      email: string | null;
    } | null;
  };
  materialListId: string;
  suppliers?: ReplicacheSupplier[];
  syncStatus?: MaterialListSyncStatus;
  verifyMode?: boolean;
  verifyOrderedQuantity?: string | null;
  verifyInitialReceivedQuantity?: string | number | null;
  verifyInitialStatus?: VerifyStatus | string | null;
  onVerifyStateChange?: (state: {
    receivedQuantity: number;
    verificationStatus: VerifyStatus;
  }) => void;
}

function formatQuantityDisplay(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "0";
  const rawValue = value.toString();
  const parsedValue = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsedValue)) return rawValue;

  return parsedValue.toLocaleString("en-CA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function VerifyQuantityColumn({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center rounded-lg bg-gray-50 px-1.5 py-1.5 text-center">
      <span className="min-w-0 text-[8px] leading-tight font-medium tracking-tighter text-gray-500 uppercase">
        {label}
      </span>
      <span className="mt-0.5 text-sm leading-none font-semibold text-gray-900 tabular-nums">
        {formatQuantityDisplay(value)}
      </span>
    </div>
  );
}

function getUserInitials(name: string | null | undefined, email: string | null | undefined) {
  const source = (name?.trim() || email?.split("@")[0]?.trim() || "?").replace(
    /[^a-z0-9\s._-]/gi,
    "",
  );
  const parts = source
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }

  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

function InitialsSyncBadge({
  user,
  status,
}: {
  user: MaterialListItemProps["item"]["addedBy"] | null | undefined;
  status: MaterialListSyncStatus;
}) {
  const displayName = user?.name?.trim() || user?.email?.trim() || "Unknown user";
  const initials = getUserInitials(user?.name, user?.email);
  const statusLabel =
    status === "syncing" ? "Syncing" : status === "pending" ? "Pending sync" : "Synced";

  const statusClasses =
    status === "syncing"
      ? "bg-blue-500 text-white ring-blue-100"
      : status === "pending"
        ? "bg-amber-500 text-white ring-amber-100"
        : "bg-emerald-500 text-white ring-emerald-100";

  const StatusIcon =
    status === "syncing"
      ? Loader2Icon
      : status === "pending"
        ? Clock3Icon
        : CheckCircle2Icon;

  return (
    <div
      className="absolute top-2 left-2 z-20"
      title={`Added by ${displayName} • ${statusLabel}`}
      aria-label={`Added by ${displayName}. ${statusLabel}.`}
    >
      <div className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/80 bg-white/95 text-xs font-semibold text-gray-800 shadow-sm ring-1 ring-black/10 backdrop-blur dark:border-border dark:bg-card/95 dark:text-foreground dark:ring-black/40">
        {initials}
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2",
            statusClasses,
          )}
        >
          <StatusIcon
            className={cn("h-2.5 w-2.5", status === "syncing" && "animate-spin")}
            strokeWidth={2.8}
          />
        </span>
      </div>
    </div>
  );
}

function MaterialListItemComponent({
  item,
  materialListId,
  suppliers,
  syncStatus,
  verifyMode = false,
  verifyOrderedQuantity,
  verifyInitialReceivedQuantity,
  verifyInitialStatus,
  onVerifyStateChange,
}: MaterialListItemProps) {
  const removeInFlightRef = useRef(false);
  const verifyLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const verifyClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const verifyLongPressTriggeredRef = useRef(false);
  const verifySuppressClickRef = useRef(false);
  const verifyPointerStartYRef = useRef<number | null>(null);
  const verifyBaseQuantityRef = useRef(0);
  const verifyDragQuantityRef = useRef(0);
  const verifyActivePointerIdRef = useRef<number | null>(null);
  const verifyPickerTouchYRef = useRef<number | null>(null);
  const verifyPickerTouchAccumulatorRef = useRef(0);
  const [verifyReceivedQuantity, setVerifyReceivedQuantity] = useState(0);
  const [verifyHasProblem, setVerifyHasProblem] = useState(false);
  const [verifyPickerQuantity, setVerifyPickerQuantity] = useState<number | null>(
    null,
  );
  const quantity = parseFloat(item.quantity);
  const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0;
  const lineTotal = item.extendedPrice
    ? parseFloat(item.extendedPrice)
    : quantity * unitCost;

  const handleRemove = () => {
    if (removeInFlightRef.current) return;
    removeInFlightRef.current = true;
    void mutateMaterialListAndSync(getMaterialListReplicache().mutate.removeItem({
      materialListId,
      itemId: item.id,
    }));
  };

  const partName =
    item.partDefinition?.displayName ||
    item.descriptionSnapshot ||
    "Unknown Part";
  const itemSyncStatus = syncStatus ?? (item.pendingSync ? "pending" : "synced");
  const orderedQuantity = verifyOrderedQuantity ?? item.quantity;
  const orderedQuantityNumber = Math.max(
    0,
    Math.round(Number.parseFloat(orderedQuantity.toString()) || 0),
  );
  const initialReceivedQuantity = Math.max(
    0,
    Math.round(Number.parseFloat(verifyInitialReceivedQuantity?.toString() ?? "0") || 0),
  );
  const isVerifyProblem = verifyHasProblem;
  const isVerifyComplete =
    !isVerifyProblem &&
    orderedQuantityNumber > 0 &&
    verifyReceivedQuantity >= orderedQuantityNumber;
  const isVerifyPartial =
    !isVerifyProblem &&
    verifyReceivedQuantity > 0 &&
    verifyReceivedQuantity < orderedQuantityNumber;
  const receivedQuantity = verifyReceivedQuantity;
  const backOrderedQuantity = Math.max(
    0,
    orderedQuantityNumber - verifyReceivedQuantity,
  );

  useEffect(() => {
    if (!verifyMode) return;
    setVerifyReceivedQuantity(clampReceivedQuantity(initialReceivedQuantity));
    setVerifyHasProblem(verifyInitialStatus === "problem");
    setVerifyPickerQuantity(null);
  }, [
    initialReceivedQuantity,
    orderedQuantity,
    verifyInitialStatus,
    verifyMode,
  ]);

  useEffect(() => {
    return () => {
      if (verifyLongPressTimerRef.current) {
        clearTimeout(verifyLongPressTimerRef.current);
      }
      if (verifyClickTimerRef.current) {
        clearTimeout(verifyClickTimerRef.current);
      }
      teardownVerifyPickerListeners();
      teardownVerifyTouchListeners();
    };
  }, []);

  const clampReceivedQuantity = (nextQuantity: number) =>
    Math.max(0, Math.min(orderedQuantityNumber, nextQuantity));

  const getVerifyStatus = (
    receivedQuantityValue: number,
    hasProblem: boolean,
  ): VerifyStatus => {
    if (hasProblem) return "problem";
    if (
      orderedQuantityNumber > 0 &&
      receivedQuantityValue >= orderedQuantityNumber
    ) {
      return "complete";
    }
    if (receivedQuantityValue > 0) return "partial";
    return "pending";
  };

  const notifyVerifyStateChange = (
    receivedQuantityValue: number,
    hasProblem: boolean,
  ) => {
    onVerifyStateChange?.({
      receivedQuantity: receivedQuantityValue,
      verificationStatus: getVerifyStatus(receivedQuantityValue, hasProblem),
    });
  };

  const toggleVerifyComplete = () => {
    if (!verifyMode) return;
    setVerifyHasProblem(false);
    setVerifyReceivedQuantity((currentValue) => {
      const nextQuantity =
        currentValue >= orderedQuantityNumber ? 0 : orderedQuantityNumber;
      notifyVerifyStateChange(nextQuantity, false);
      return nextQuantity;
    });
  };

  const toggleVerifyProblem = () => {
    if (!verifyMode) return;
    setVerifyHasProblem((currentValue) => {
      const nextHasProblem = !currentValue;
      notifyVerifyStateChange(verifyReceivedQuantity, nextHasProblem);
      return nextHasProblem;
    });
  };

  const clearVerifyLongPressTimer = () => {
    if (!verifyLongPressTimerRef.current) return;
    clearTimeout(verifyLongPressTimerRef.current);
    verifyLongPressTimerRef.current = null;
  };

  const updateVerifyPickerQuantity = (clientY: number) => {
    if (
      !verifyLongPressTriggeredRef.current ||
      verifyPointerStartYRef.current === null
    ) {
      return;
    }

    const deltaY = clientY - verifyPointerStartYRef.current;
    const steps = Math.round(deltaY / 18);
    const nextQuantity = clampReceivedQuantity(
      verifyBaseQuantityRef.current + steps,
    );
    verifyDragQuantityRef.current = nextQuantity;
    setVerifyPickerQuantity(nextQuantity);
  };

  function teardownVerifyPickerListeners() {
    window.removeEventListener("pointermove", handleVerifyWindowPointerMove);
    window.removeEventListener("pointerup", handleVerifyWindowPointerUp);
    window.removeEventListener("pointercancel", handleVerifyWindowPointerCancel);
  }

  function teardownVerifyTouchListeners() {
    window.removeEventListener("touchmove", handleVerifyWindowTouchMove);
    window.removeEventListener("touchend", handleVerifyWindowTouchEnd);
    window.removeEventListener("touchcancel", handleVerifyWindowTouchCancel);
  }

  function finishVerifyPickerSelection() {
    const nextQuantity = verifyDragQuantityRef.current;
    setVerifyReceivedQuantity(nextQuantity);
    notifyVerifyStateChange(nextQuantity, verifyHasProblem);
    setVerifyPickerQuantity(null);
    verifyLongPressTriggeredRef.current = false;
    verifyPointerStartYRef.current = null;
    verifyActivePointerIdRef.current = null;
    verifyPickerTouchYRef.current = null;
    verifyPickerTouchAccumulatorRef.current = 0;
    teardownVerifyPickerListeners();
    teardownVerifyTouchListeners();
  }

  function cancelVerifyPickerSelection() {
    setVerifyPickerQuantity(null);
    verifyLongPressTriggeredRef.current = false;
    verifyPointerStartYRef.current = null;
    verifyActivePointerIdRef.current = null;
    verifyPickerTouchYRef.current = null;
    verifyPickerTouchAccumulatorRef.current = 0;
    teardownVerifyPickerListeners();
    teardownVerifyTouchListeners();
  }

  function updateVerifyTouchPickerQuantity(touchY: number) {
    if (!verifyLongPressTriggeredRef.current) {
      return;
    }

    if (verifyPickerTouchYRef.current === null) {
      verifyPickerTouchYRef.current = touchY;
      return;
    }

    const deltaY = touchY - verifyPickerTouchYRef.current;
    verifyPickerTouchAccumulatorRef.current += deltaY;
    verifyPickerTouchYRef.current = touchY;

    const stepSize = 18;
    const stepDelta = Math.trunc(
      verifyPickerTouchAccumulatorRef.current / stepSize,
    );
    if (stepDelta === 0) {
      return;
    }

    verifyPickerTouchAccumulatorRef.current -= stepDelta * stepSize;

    setVerifyPickerQuantity((currentValue) => {
      if (currentValue === null) {
        return currentValue;
      }

      const nextQuantity = clampReceivedQuantity(currentValue + stepDelta);
      verifyDragQuantityRef.current = nextQuantity;
      return nextQuantity;
    });
  }

  function handleVerifyWindowTouchMove(event: TouchEvent) {
    if (!verifyLongPressTriggeredRef.current || event.touches.length === 0) {
      return;
    }

    event.preventDefault();

    const touchY = event.touches[0]?.clientY;
    if (touchY === undefined) {
      return;
    }

    updateVerifyTouchPickerQuantity(touchY);
  }

  function handleVerifyWindowTouchEnd(event: TouchEvent) {
    clearVerifyLongPressTimer();

    if (verifyLongPressTriggeredRef.current) {
      event.preventDefault();
      finishVerifyPickerSelection();
      return;
    }

    verifyPickerTouchYRef.current = null;
    verifyPickerTouchAccumulatorRef.current = 0;
    teardownVerifyTouchListeners();
  }

  function handleVerifyWindowTouchCancel() {
    clearVerifyLongPressTimer();
    cancelVerifyPickerSelection();
  }

  function handleVerifyWindowPointerMove(event: PointerEvent) {
    if (verifyActivePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    updateVerifyPickerQuantity(event.clientY);
  }

  function handleVerifyWindowPointerUp(event: PointerEvent) {
    if (verifyActivePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    clearVerifyLongPressTimer();

    if (verifyLongPressTriggeredRef.current) {
      finishVerifyPickerSelection();
    }
  }

  function handleVerifyWindowPointerCancel(event: PointerEvent) {
    if (verifyActivePointerIdRef.current !== event.pointerId) return;
    clearVerifyLongPressTimer();
    cancelVerifyPickerSelection();
  }

  const handleVerifyPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!verifyMode) return;
    if (event.pointerType === "touch") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    verifyLongPressTriggeredRef.current = false;
    verifySuppressClickRef.current = false;
    verifyActivePointerIdRef.current = event.pointerId;
    verifyPointerStartYRef.current = event.clientY;
    verifyBaseQuantityRef.current = verifyReceivedQuantity;
    verifyDragQuantityRef.current = verifyReceivedQuantity;
    const pointerElement = event.currentTarget;
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);

    verifyLongPressTimerRef.current = setTimeout(() => {
      verifyLongPressTriggeredRef.current = true;
      verifySuppressClickRef.current = true;
      setVerifyPickerQuantity(verifyBaseQuantityRef.current);

      if (pointerElement.hasPointerCapture(pointerId)) {
        pointerElement.releasePointerCapture(pointerId);
      }

      window.addEventListener("pointermove", handleVerifyWindowPointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handleVerifyWindowPointerUp, {
        passive: false,
      });
      window.addEventListener("pointercancel", handleVerifyWindowPointerCancel);
    }, 450);
  };

  const handleVerifyTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!verifyMode) return;

    const touchY = event.touches[0]?.clientY;
    if (touchY === undefined) {
      return;
    }

    clearVerifyLongPressTimer();
    verifyLongPressTriggeredRef.current = false;
    verifySuppressClickRef.current = false;
    verifyPointerStartYRef.current = null;
    verifyActivePointerIdRef.current = null;
    verifyBaseQuantityRef.current = verifyReceivedQuantity;
    verifyDragQuantityRef.current = verifyReceivedQuantity;
    verifyPickerTouchYRef.current = touchY;
    verifyPickerTouchAccumulatorRef.current = 0;

    window.addEventListener("touchmove", handleVerifyWindowTouchMove, {
      passive: false,
    });
    window.addEventListener("touchend", handleVerifyWindowTouchEnd, {
      passive: false,
    });
    window.addEventListener("touchcancel", handleVerifyWindowTouchCancel, {
      passive: false,
    });

    verifyLongPressTimerRef.current = setTimeout(() => {
      verifyLongPressTriggeredRef.current = true;
      verifySuppressClickRef.current = true;
      setVerifyPickerQuantity(verifyBaseQuantityRef.current);
    }, 450);
  };

  const handleVerifyPointerUp = () => {
    if (!verifyMode) return;
    clearVerifyLongPressTimer();

    if (verifyLongPressTriggeredRef.current) {
      finishVerifyPickerSelection();
    }
  };

  const handleVerifyPointerCancel = () => {
    if (!verifyMode) return;
    clearVerifyLongPressTimer();
    cancelVerifyPickerSelection();
  };

  const handleVerifyClick = () => {
    if (!verifyMode) return;
    if (verifySuppressClickRef.current) {
      verifySuppressClickRef.current = false;
      return;
    }

    if (verifyClickTimerRef.current) {
      clearTimeout(verifyClickTimerRef.current);
      verifyClickTimerRef.current = null;
      toggleVerifyProblem();
      return;
    }

    verifyClickTimerRef.current = setTimeout(() => {
      verifyClickTimerRef.current = null;
      toggleVerifyComplete();
    }, 260);
  };

  return (
    <Card
      className={cn(
        "group relative h-full w-full gap-0 overflow-hidden rounded-2xl py-0 shadow-sm transition-all [content-visibility:auto] [contain-intrinsic-size:20rem] hover:shadow-md",
        verifyMode && "cursor-pointer select-none",
        verifyMode &&
          isVerifyComplete &&
          "border-emerald-300 bg-emerald-50/50 ring-2 ring-emerald-400/60",
        verifyMode &&
          isVerifyPartial &&
          "border-orange-300 bg-orange-50/50 ring-2 ring-orange-400/60",
        verifyMode &&
          isVerifyProblem &&
          "border-red-300 bg-red-50/50 ring-2 ring-red-400/60",
      )}
      style={
        verifyMode
          ? {
              WebkitTouchCallout: "none",
              WebkitUserSelect: "none",
              WebkitTapHighlightColor: "transparent",
              touchAction: "manipulation",
              userSelect: "none",
            }
          : undefined
      }
      onContextMenu={verifyMode ? (event) => event.preventDefault() : undefined}
      onClick={verifyMode ? handleVerifyClick : undefined}
      onKeyDown={
        verifyMode
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleVerifyComplete();
              }
            }
          : undefined
      }
      role={verifyMode ? "button" : undefined}
      tabIndex={verifyMode ? 0 : undefined}
      aria-pressed={verifyMode ? isVerifyComplete : undefined}
      aria-label={
        verifyMode
          ? isVerifyProblem
            ? "Part has a problem"
            : isVerifyComplete
              ? "Part verified complete"
              : "Verify part"
          : undefined
      }
      onPointerDown={verifyMode ? handleVerifyPointerDown : undefined}
      onPointerUp={verifyMode ? handleVerifyPointerUp : undefined}
      onPointerCancel={verifyMode ? handleVerifyPointerCancel : undefined}
      onTouchStart={verifyMode ? handleVerifyTouchStart : undefined}
      onPointerLeave={
        verifyMode
          ? () => {
              if (verifyLongPressTriggeredRef.current) return;
              clearVerifyLongPressTimer();
            }
          : undefined
      }
    >
      <CardContent className="h-full p-0">
        <div className="flex h-full w-full flex-col px-3 pt-3 pb-2">
          <InitialsSyncBadge user={item.addedBy} status={itemSyncStatus} />
          <div
            className="relative mb-3 aspect-square w-full overflow-hidden rounded-xl bg-gray-100"
            style={
              verifyMode
                ? {
                    WebkitTouchCallout: "none",
                    WebkitUserSelect: "none",
                    userSelect: "none",
                  }
                : undefined
            }
            onContextMenu={
              verifyMode ? (event) => event.preventDefault() : undefined
            }
          >
            {item.partDefinition?.imageUrl ? (
              <Image
                src={item.partDefinition.imageUrl}
                alt={item.partDefinition.displayName}
                fill
                className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                draggable={false}
                onContextMenu={
                  verifyMode ? (event) => event.preventDefault() : undefined
                }
                style={
                  verifyMode
                    ? {
                        WebkitTouchCallout: "none",
                        WebkitUserSelect: "none",
                        userSelect: "none",
                      }
                    : undefined
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-300">
                <svg
                  className="h-7 w-7 sm:h-9 sm:w-9"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
              </div>
            )}
            {verifyMode && isVerifyComplete && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-emerald-500/10">
                <CheckCircle2Icon
                  className="h-20 w-20 text-emerald-600 opacity-60 sm:h-24 sm:w-24"
                  strokeWidth={2.5}
                />
              </div>
            )}
            {verifyMode && isVerifyPartial && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-orange-500/10">
                <Clock3Icon
                  className="h-20 w-20 text-orange-600 opacity-60 sm:h-24 sm:w-24"
                  strokeWidth={2.5}
                />
              </div>
            )}
            {verifyMode && isVerifyProblem && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-red-500/10">
                <XCircleIcon
                  className="h-20 w-20 text-red-600 opacity-60 sm:h-24 sm:w-24"
                  strokeWidth={2.5}
                />
              </div>
            )}

          </div>

          {verifyMode && (
            <div className="mb-3 grid grid-cols-3 gap-1">
              <VerifyQuantityColumn label="Ordered" value={orderedQuantity} />
              <VerifyQuantityColumn label="Received" value={receivedQuantity} />
              <VerifyQuantityColumn
                label="Back Ordered"
                value={backOrderedQuantity}
              />
            </div>
          )}

          <div className="flex items-start justify-center text-center text-black">
            <h3 className="line-clamp-4 text-sm font-medium leading-snug">
              {partName}
            </h3>
          </div>

          {!verifyMode && (
            <div className="mt-auto flex flex-col gap-1 pt-2">
              <div className="flex min-h-10 items-center gap-1 px-0 py-1">
                <span className="shrink-0 text-[9px] font-medium tracking-tighter text-gray-400 uppercase">
                  Quantity
                </span>
                <QuantityControls
                  itemId={item.id}
                  quantity={quantity}
                  materialListId={materialListId}
                  pendingSync={item.pendingSync}
                  compact
                />
              </div>

              <div className="flex min-h-10 items-center gap-1 px-0 py-1">
                <span className="shrink-0 text-[9px] font-medium tracking-tighter text-gray-400 uppercase">
                  Supplier
                </span>
                <SupplierSelector
                  itemId={item.id}
                  partDefinitionId={item.partDefinition?.id ?? ""}
                  currentSupplierPartId={item.supplierPart?.id}
                  currentSupplierId={item.selectedSupplierId}
                  materialListId={materialListId}
                  suppliers={suppliers}
                  compact
                />
              </div>

              <div className="grid min-h-10 min-w-0 grid-cols-[3rem_minmax(0,1fr)_2rem] items-center gap-0.5 px-1">
                <span className="text-[10px] font-medium tracking-wide text-gray-400 uppercase">
                  Total
                </span>
                <span className="min-w-0 truncate text-right text-sm font-semibold text-gray-900 tabular-nums sm:text-base">
                  ${lineTotal.toFixed(2)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  onClick={handleRemove}
                  aria-label="Remove item"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
      {verifyPickerQuantity !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <VerticalPickerOverlay
            title="Qty Received"
            subtitle={partName}
            centerIndex={verifyPickerQuantity}
            getItem={(value) =>
              value < 0 || value > orderedQuantityNumber ? null : value
            }
            renderItem={(value) => value}
          />,
          document.body,
        )}
    </Card>
  );
}

export const MaterialListItem = memo(MaterialListItemComponent);
