"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQueuedReceiptIntent } from "~/hooks/use-queued-receipt-intent";
import {
  AlertTriangleIcon,
  CheckIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export type ReceiveStatus = "pending" | "partial" | "complete" | "problem";
export type TableReceive = {
  ordered: string | number;
  received: string | number | null | undefined;
  status: string | null | undefined;
  unit?: string | null;
  /** Shown without controls, for members who cannot receive or offline. */
  readOnly?: boolean;
  /** Reset local controls after a refused save. */
  resetVersion?: number;
  saving?: boolean;
  canStartReceipt?: () => boolean;
  onPendingChange?: (pending: boolean) => void;
  /** The order was cancelled; nothing is coming. */
  cancelled?: boolean;
  /** What a packing slip says about this part. */
  badge?: ReactNode;
  onChange?: (state: {
    receivedQuantity: number;
    verificationStatus: ReceiveStatus;
  }) => void;
};

const whole = (value: string | number | null | undefined) =>
  Math.max(0, Math.round(Number(value) || 0));
const SAVE_DELAY = 500;

/** Received count and status for an ordered part on a material list table
 * row. Stepper taps save after a pause; All and Problem save at once. */
export function useTableReceive(receive: TableReceive) {
  const ordered = whole(receive.ordered);
  const initial = Math.min(ordered, whole(receive.received));
  const initialProblem = receive.status === "problem";
  const [received, setReceived] = useState(initial);
  const [problem, setProblem] = useState(initialProblem);
  const [text, setText] = useState<string | null>(null);
  const latest = useRef(receive);
  useLayoutEffect(() => { latest.current = receive; });
  const intent = useQueuedReceiptIntent(receive.onPendingChange);
  const locked = () => !!latest.current.readOnly || !!latest.current.cancelled || latest.current.canStartReceipt?.() === false;
  // Saved changes come back as new props; show them.
  const resetVersion = receive.resetVersion ?? 0;
  const [shown, setShown] = useState({ initial, initialProblem, resetVersion });
  if (shown.initial !== initial || shown.initialProblem !== initialProblem || shown.resetVersion !== resetVersion) {
    setShown({ initial, initialProblem, resetVersion });
    setReceived(initial);
    setProblem(initialProblem);
    setText(null);
  }
  const statusOf = (count: number, flagged: boolean): ReceiveStatus =>
    flagged
      ? "problem"
      : ordered > 0 && count >= ordered
        ? "complete"
        : count > 0
          ? "partial"
          : "pending";
  const save = (count: number, flagged: boolean, delay = 0) => {
    intent.schedule(() => receive.onChange?.({
      receivedQuantity: count,
      verificationStatus: statusOf(count, flagged),
    }), delay);
  };
  const setCount = (count: number, delay = SAVE_DELAY) => {
    if (locked()) return;
    const next = Math.max(0, Math.min(ordered, Math.round(count)));
    setReceived(next);
    save(next, problem, delay);
  };
  const commitText = () => {
    if (locked() || text === null) return;
    setText(null);
    if (text.trim() && Number.isFinite(Number(text))) setCount(Number(text), 0);
  };

  return {
    ordered,
    received,
    problem,
    status: statusOf(received, problem),
    locked: !!receive.readOnly || !!receive.cancelled,
    unit: receive.unit ? ` ${receive.unit}` : "",
    text,
    setText: (value: string | null) => { if (!locked()) setText(value); },
    commitText,
    step: (delta: number) => setCount(received + delta),
    toggleAll: () => {
      if (locked()) return;
      const next = received >= ordered ? 0 : ordered;
      setProblem(false);
      setReceived(next);
      save(next, false);
    },
    toggleProblem: () => {
      if (locked()) return;
      setProblem(!problem);
      save(received, !problem);
    },
  };
}
export type TableReceiveState = ReturnType<typeof useTableReceive>;

export const receiveTint = (status: ReceiveStatus) =>
  cn(
    status === "complete" && "bg-emerald-50/70 dark:bg-emerald-950/30",
    status === "partial" && "bg-orange-50/70 dark:bg-orange-950/30",
    status === "problem" && "bg-red-50/70 dark:bg-red-950/30",
  );

/** Status, slip badge, All and Problem, under the part name. */
export function ReceiveSummary({
  receive,
  state,
}: {
  receive: TableReceive;
  state: TableReceiveState;
}) {
  const { status } = state;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span
        className={cn(
          "font-medium",
          status === "complete" && "text-emerald-700 dark:text-emerald-400",
          status === "partial" && "text-orange-700 dark:text-orange-400",
          status === "problem" && "text-red-700 dark:text-red-400",
          (status === "pending" || receive.cancelled) &&
            "text-muted-foreground",
        )}
      >
        {receive.saving
          ? "Saving receipt…"
          : receive.cancelled
          ? "Cancelled"
          : status === "complete"
            ? "All received"
            : status === "partial"
              ? "Part received"
              : status === "problem"
                ? "Problem"
                : "Not received"}
      </span>
      {receive.badge}
      {!state.locked && (
        <span className="ml-auto flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            aria-pressed={status === "complete"}
            onClick={state.toggleAll}
          >
            <CheckIcon className="h-3.5 w-3.5" />
            All
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-7 px-2 text-xs",
              state.problem && "border-red-400 text-red-700 dark:text-red-400",
            )}
            aria-pressed={state.problem}
            onClick={state.toggleProblem}
          >
            <AlertTriangleIcon className="h-3.5 w-3.5" />
            Problem
          </Button>
        </span>
      )}
    </div>
  );
}

/** The received count, with a stepper when it can be changed. */
export function ReceiveCounter({
  state,
  name,
}: {
  state: TableReceiveState;
  name: string;
}) {
  const { received, ordered } = state;
  if (state.locked)
    return (
      <span className="text-sm font-semibold">
        {received}
        {state.unit}
      </span>
    );
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        aria-label={`One less received: ${name}`}
        disabled={received <= 0}
        onClick={() => state.step(-1)}
      >
        <MinusIcon className="h-3.5 w-3.5" />
      </Button>
      <input
        aria-label={`Received: ${name}`}
        type="number"
        inputMode="numeric"
        min={0}
        max={ordered}
        className="border-input bg-card h-7 w-12 rounded-md border px-1 text-center text-sm font-semibold"
        value={state.text ?? String(received)}
        onChange={(event) => state.setText(event.target.value)}
        onBlur={state.commitText}
        onKeyDown={(event) => {
          if (event.key === "Enter") state.commitText();
          if (event.key === "Escape") state.setText(null);
        }}
      />
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        aria-label={`One more received: ${name}`}
        disabled={received >= ordered}
        onClick={() => state.step(1)}
      >
        <PlusIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
