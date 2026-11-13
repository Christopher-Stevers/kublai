"use client";
import { OrdinaryMaterialListItem } from "./OrdinaryMaterialListItem";
import { InitialsSyncBadge, MaterialListPartPhoto, MaterialListRowMenu, MaterialListEditableFields } from "./MaterialListItemPresentation";
import { useQueuedReceiptIntent } from "~/hooks/use-queued-receipt-intent";
import { startSpeedPaint } from "~/lib/speed-telemetry";
import { SentMaterialStatus, type SentMaterialOrder } from "./SentMaterialStatus";
import { firstText } from "~/lib/first-text";
import type { SupplierVersion } from "~/lib/job-supplier-defaults";

import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent } from "~/components/ui/card";
import { VerticalPickerOverlay } from "~/components/materialLists/wizard/VerticalPickerOverlay";

import {
  CheckCircle2Icon,
  Clock3Icon,
  XCircleIcon,
} from "lucide-react";
import { useWorkspaceMutations } from "~/hooks/use-workspace-mutations";
import { cn } from "~/lib/utils";
import type { ReplicacheSupplier } from "~/hooks/use-replicache-suppliers";
import {
  resolveReplicacheSyncStatus,
  useReplicacheSyncing,
  type ReplicacheSyncStatus,
} from "~/hooks/use-replicache-material-list";
import { useSyncSessionStatus } from "~/hooks/use-sync-session-status";

type MaterialListSyncStatus = ReplicacheSyncStatus;
type VerifyStatus = "pending" | "partial" | "complete" | "problem";

export interface MaterialListItemProps {
  item: {
    jobPriceStatus?: string;
    sentOrderItemId?: string | null;
    supplierVersion?: SupplierVersion | null;
    sentOrder?: SentMaterialOrder | null;
    id: string;
    quantity: string;
    unitCost: string | null;
    extendedPrice: string | null;
    descriptionSnapshot: string | null;
    roomId?: string | null;
    roomName?: string | null;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
    pendingSync?: boolean;
    partDefinition: {
      id: string;
      displayName: string;
      piecesPerPack?: number | null;
      bulkUnit?: string | null;
      individualUnit?: string | null;
      imageUrl: string | null;
      material: string | null;
    } | null;
    selectedSupplierId?: string | null;
    supplierPart: {
      id: string;
      supplierId: string;
      supplierSku: string | null;
      lastKnownUnitCost: string | null;
    packSize?: string | null;
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
  /** Tool request lines go to the tool room: no supplier, no prices. */
  isToolRequest?: boolean;
  verifyOrderedQuantity?: string | null;
  verifyInitialReceivedQuantity?: string | number | null;
  verifyInitialStatus?: string | null;
  /** Reset a locally edited receipt after a refused save, even if saved values did not change. */
  verifyResetVersion?: number;
  canStartReceipt?: () => boolean;
  onVerifyPendingChange?: (pending: boolean) => void;
  onVerifyStateChange?: (state: {
    receivedQuantity: number;
    verificationStatus: VerifyStatus;
  }) => void;
  /** Shown on the photo in verify mode, e.g. what a packing slip says. */
  verifyBadge?: ReactNode;
  /** Shown under the part name in verify mode, e.g. a link to its order. */
  verifyCaption?: ReactNode;
  /** Show the verify card without letting taps change it. */
  verifyReadOnly?: boolean;
  /** At least one line on this same order has been received. */
  orderHasReceipts?: boolean;
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
    <div className="flex min-w-0 flex-col items-center justify-center rounded-lg bg-muted/50 px-1.5 py-1.5 text-center">
      <span className="min-w-0 text-[8px] leading-tight font-medium tracking-tighter text-muted-foreground uppercase">
        {label}
      </span>
      <span className="mt-0.5 text-sm leading-none font-semibold text-foreground tabular-nums">
        {formatQuantityDisplay(value)}
      </span>
    </div>
  );
}

function MaterialListItemComponent({
  item,
  materialListId,
  suppliers,
  syncStatus,
  verifyMode = false,
  isToolRequest = false,
  verifyOrderedQuantity,
  verifyInitialReceivedQuantity,
  verifyInitialStatus,
  verifyResetVersion = 0,
  onVerifyStateChange,
  onVerifyPendingChange,
  canStartReceipt,
  verifyBadge,
  verifyCaption,
  verifyReadOnly = false,
  orderHasReceipts = false,
}: MaterialListItemProps) {
  const { getReplicache: getMaterialListReplicache, mutateAndSync: mutateMaterialListAndSync } = useWorkspaceMutations();
  const removeInFlightRef = useRef(false);
  const verifyLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const verifySingleClick = useQueuedReceiptIntent(onVerifyPendingChange, "cancel");
  const receiptAllowed = useRef({ verifyReadOnly, verifyMode, canStartReceipt });
  useLayoutEffect(() => { receiptAllowed.current = { verifyReadOnly, verifyMode, canStartReceipt }; });
  const verifyLocked = () => receiptAllowed.current.verifyReadOnly || !receiptAllowed.current.verifyMode || receiptAllowed.current.canStartReceipt?.() === false;
  const verifyLongPressTriggeredRef = useRef(false);
  const verifySuppressClickRef = useRef(false);
  const verifyPointerStartYRef = useRef<number | null>(null);
  const verifyBaseQuantityRef = useRef(0);
  const verifyDragQuantityRef = useRef(0);
  const verifyActivePointerIdRef = useRef<number | null>(null);
  const verifyPickerTouchYRef = useRef<number | null>(null);
  const verifyPickerTouchAccumulatorRef = useRef(0);
  // Window listeners are removed by the closures that added them, so a later
  // render's handlers can't leave the earlier ones attached.
  const verifyPickerListenersRef = useRef<(() => void) | null>(null);
  const verifyTouchListenersRef = useRef<(() => void) | null>(null);
  const [verifyReceivedQuantity, setVerifyReceivedQuantity] = useState(0);
  const [verifyHasProblem, setVerifyHasProblem] = useState(false);
  const verifyValue = useRef({ quantity: verifyReceivedQuantity, problem: verifyHasProblem });
  useLayoutEffect(() => { verifyValue.current = { quantity: verifyReceivedQuantity, problem: verifyHasProblem }; });
  const [verifyPickerQuantity, setVerifyPickerQuantity] = useState<number | null>(
    null,
  );

  const handleRemove = () => {
    if (removeInFlightRef.current) return;
    removeInFlightRef.current = true;
    void mutateMaterialListAndSync(getMaterialListReplicache().mutate.removeItem({
      materialListId,
      itemId: item.id,
    }));
  };

  const partName =
    firstText(item.partDefinition?.displayName, item.descriptionSnapshot) ??
    "Unknown Part";
  const isReplicacheSyncing = useReplicacheSyncing(
    !syncStatus && !!item.pendingSync,
  );
  const transportStatus = useSyncSessionStatus(
    syncStatus ??
    resolveReplicacheSyncStatus(item.pendingSync, isReplicacheSyncing),
  );
  // Keep the card pending if sync is blocked, even when its local value is saved.
  const itemSyncStatus: MaterialListSyncStatus =
    transportStatus === "sign-in-required" || transportStatus === "connection-error"
      ? "pending" : transportStatus;
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

  // Receiving starts again from the saved counts whenever they change.
  const verifyStart = verifyMode
    ? JSON.stringify([initialReceivedQuantity, orderedQuantityNumber, verifyInitialStatus ?? null, verifyResetVersion])
    : null;
  const [verifyStarted, setVerifyStarted] = useState<string | null>(null);
  if (verifyStart !== verifyStarted) {
    setVerifyStarted(verifyStart);
    if (verifyMode) {
      setVerifyReceivedQuantity(Math.max(0, Math.min(orderedQuantityNumber, initialReceivedQuantity)));
      setVerifyHasProblem(verifyInitialStatus === "problem");
      setVerifyPickerQuantity(null);
    }
  }

  useEffect(() => {
    const longPressTimer = verifyLongPressTimerRef;
    const pickerListeners = verifyPickerListenersRef;
    const touchListeners = verifyTouchListenersRef;
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      pickerListeners.current?.();
      touchListeners.current?.();
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
    if (verifyLocked()) return;
    verifySingleClick.cancel();
    const painted = startSpeedPaint("write-to-paint");
    const nextQuantity = verifyValue.current.quantity >= orderedQuantityNumber ? 0 : orderedQuantityNumber;
    verifyValue.current = { quantity: nextQuantity, problem: false };
    setVerifyHasProblem(false);
    setVerifyReceivedQuantity(nextQuantity);
    notifyVerifyStateChange(nextQuantity, false);
    painted();
  };

  const toggleVerifyProblem = () => {
    if (verifyLocked()) return;
    verifySingleClick.cancel();
    const nextHasProblem = !verifyValue.current.problem;
    const quantity = verifyValue.current.quantity;
    verifyValue.current = { quantity, problem: nextHasProblem };
    setVerifyHasProblem(nextHasProblem);
    notifyVerifyStateChange(quantity, nextHasProblem);
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
    verifyPickerListenersRef.current?.();
    verifyPickerListenersRef.current = null;
  }

  function teardownVerifyTouchListeners() {
    verifyTouchListenersRef.current?.();
    verifyTouchListenersRef.current = null;
  }

  function finishVerifyPickerSelection() {
    if (verifyLocked()) { cancelVerifyPickerSelection(); return; }
    const nextQuantity = verifyDragQuantityRef.current;
    verifyValue.current.quantity = nextQuantity;
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
    if (verifyLocked()) return;
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
      if (verifyLocked()) return;
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
      verifyPickerListenersRef.current = () => {
        window.removeEventListener("pointermove", handleVerifyWindowPointerMove);
        window.removeEventListener("pointerup", handleVerifyWindowPointerUp);
        window.removeEventListener("pointercancel", handleVerifyWindowPointerCancel);
      };
    }, 450);
  };

  const handleVerifyTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (verifyLocked()) return;

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

    teardownVerifyTouchListeners();
    window.addEventListener("touchmove", handleVerifyWindowTouchMove, {
      passive: false,
    });
    window.addEventListener("touchend", handleVerifyWindowTouchEnd, {
      passive: false,
    });
    window.addEventListener("touchcancel", handleVerifyWindowTouchCancel, {
      passive: false,
    });
    verifyTouchListenersRef.current = () => {
      window.removeEventListener("touchmove", handleVerifyWindowTouchMove);
      window.removeEventListener("touchend", handleVerifyWindowTouchEnd);
      window.removeEventListener("touchcancel", handleVerifyWindowTouchCancel);
    };

    verifyLongPressTimerRef.current = setTimeout(() => {
      if (verifyLocked()) return;
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
    if (verifyLocked()) return;
    if (verifySuppressClickRef.current) {
      verifySuppressClickRef.current = false;
      return;
    }
    if (verifySingleClick.hasPending()) {
      verifySingleClick.cancel();
      toggleVerifyProblem();
      return;
    }
    // Capture this click's count; removal cancels it as before. The table
    // separately preserves its existing flush-on-removal behavior.
    const nextQuantity = verifyReceivedQuantity >= orderedQuantityNumber ? 0 : orderedQuantityNumber;
    verifySingleClick.schedule(() => {
      const painted = startSpeedPaint("write-to-paint");
      verifyValue.current = { quantity: nextQuantity, problem: false };
      setVerifyHasProblem(false);
      setVerifyReceivedQuantity(nextQuantity);
      notifyVerifyStateChange(nextQuantity, false);
      painted();
    }, 260);
  };

  const verifyTappable = verifyMode && !verifyReadOnly;
  return (
    <Card
      className={cn(
        "group relative h-full w-full gap-0 overflow-hidden rounded-2xl py-0 shadow-sm transition-all [content-visibility:auto] [contain-intrinsic-size:20rem] hover:shadow-md",
        verifyTappable && "cursor-pointer select-none",
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
      onContextMenu={verifyTappable ? (event) => event.preventDefault() : undefined}
      onClick={verifyTappable ? handleVerifyClick : undefined}
      onKeyDown={
        verifyTappable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleVerifyComplete();
              }
            }
          : undefined
      }
      role={verifyTappable ? "button" : undefined}
      tabIndex={verifyTappable ? 0 : undefined}
      aria-pressed={verifyTappable ? isVerifyComplete : undefined}
      aria-label={
        verifyTappable
          ? isVerifyProblem
            ? "Part has a problem"
            : isVerifyComplete
              ? "Part verified complete"
              : "Verify part"
          : undefined
      }
      onPointerDown={verifyTappable ? handleVerifyPointerDown : undefined}
      onPointerUp={verifyTappable ? handleVerifyPointerUp : undefined}
      onPointerCancel={verifyTappable ? handleVerifyPointerCancel : undefined}
      onTouchStart={verifyTappable ? handleVerifyTouchStart : undefined}
      onPointerLeave={
        verifyTappable
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
          {!verifyMode && !item.sentOrderItemId && (
            // Card actions live in a menu so more can be added later.
            <MaterialListRowMenu partName={partName} handleRemove={handleRemove} />
          )}
          <MaterialListPartPhoto item={item} verifyMode={verifyMode}>
            {verifyMode && verifyBadge && (
              <div className="absolute top-2 right-2 z-20">{verifyBadge}</div>
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

          </MaterialListPartPhoto>

          {verifyMode && (
            <div className="mb-3 grid grid-cols-3 gap-1">
              <VerifyQuantityColumn label="Ordered" value={orderedQuantity} />
              <VerifyQuantityColumn label="Received" value={receivedQuantity} />
              <VerifyQuantityColumn
                label={orderHasReceipts || receivedQuantity > 0 ? "Back Ordered" : "Awaiting delivery"}
                value={backOrderedQuantity}
              />
            </div>
          )}

          <div className="flex items-start justify-center text-center text-foreground">
            <h3 className="line-clamp-4 text-sm font-medium leading-snug">
              {partName}
            </h3>
          </div>
          {item.roomName && (
            <p className="mt-1 text-center text-xs text-muted-foreground">
              Room: {item.roomName}
            </p>
          )}
          {verifyMode && verifyCaption}

          {!verifyMode && item.sentOrder && <SentMaterialStatus order={item.sentOrder} materialListId={materialListId} unit={firstText(item.partDefinition?.bulkUnit, item.uom?.code)} />}
          {!verifyMode && !item.sentOrderItemId && (
            <MaterialListEditableFields item={item} materialListId={materialListId} suppliers={suppliers} isToolRequest={isToolRequest} />
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

/** Only never-sent, non-receiving rows can skip the receipt controller.
 * Sent/read-only rows keep its existing lifecycle even outside verify mode. */
function MaterialListItemBoundary(props: MaterialListItemProps) {
  return !props.verifyMode && !props.item.sentOrderItemId && !props.item.sentOrder
    ? <OrdinaryMaterialListItem {...props} />
    : <MaterialListItemComponent {...props} />;
}
export const MaterialListItem = memo(MaterialListItemBoundary);
