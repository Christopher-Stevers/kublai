"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  CheckIcon,
  LockKeyholeIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export type ReceiveStatus = "pending" | "partial" | "complete" | "problem";
export type TableReceive = {
  orderId: string;
  orderNumber: string | null;
  orderHref: string;
  ordered: string | number;
  received: string | number | null | undefined;
  status: string | null | undefined;
  unit?: string | null;
  /** Shown without controls, for members who cannot receive or offline. */
  readOnly?: boolean;
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

/** The verify controls for an ordered part, on a material list table row. */
export function TableReceiveControls({
  receive,
  name,
}: {
  receive: TableReceive;
  name: string;
}) {
  const ordered = whole(receive.ordered);
  const initial = Math.min(ordered, whole(receive.received));
  const initialProblem = receive.status === "problem";
  const [received, setReceived] = useState(initial);
  const [problem, setProblem] = useState(initialProblem);
  const [text, setText] = useState<string | null>(null);
  const pending = useRef<{
    timer: ReturnType<typeof setTimeout>;
    send: () => void;
  } | null>(null);
  // Saved changes come back as new props; show them.
  const [shown, setShown] = useState({ initial, initialProblem });
  if (shown.initial !== initial || shown.initialProblem !== initialProblem) {
    setShown({ initial, initialProblem });
    setReceived(initial);
    setProblem(initialProblem);
  }
  // A count still waiting to save is sent when the row goes away.
  useEffect(
    () => () => {
      if (!pending.current) return;
      clearTimeout(pending.current.timer);
      pending.current.send();
    },
    [],
  );

  const statusOf = (count: number, flagged: boolean): ReceiveStatus =>
    flagged
      ? "problem"
      : ordered > 0 && count >= ordered
        ? "complete"
        : count > 0
          ? "partial"
          : "pending";
  const save = (count: number, flagged: boolean, delay = 0) => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    const send = () => {
      pending.current = null;
      receive.onChange?.({
        receivedQuantity: count,
        verificationStatus: statusOf(count, flagged),
      });
    };
    if (delay) pending.current = { timer: setTimeout(send, delay), send };
    else send();
  };
  const setCount = (count: number, delay = SAVE_DELAY) => {
    const next = Math.max(0, Math.min(ordered, Math.round(count)));
    setReceived(next);
    save(next, problem, delay);
  };
  const commitText = () => {
    if (text === null) return;
    setText(null);
    if (text.trim() && Number.isFinite(Number(text))) setCount(Number(text), 0);
  };

  const status = statusOf(received, problem);
  const locked = !!receive.readOnly;
  const unit = receive.unit ? ` ${receive.unit}` : "";
  return (
    <div
      className={cn(
        "mt-2 space-y-2 rounded-lg border p-2 text-xs",
        status === "complete" &&
          "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30",
        status === "partial" &&
          "border-orange-300 bg-orange-50/60 dark:border-orange-800 dark:bg-orange-950/30",
        status === "problem" &&
          "border-red-300 bg-red-50/60 dark:border-red-800 dark:bg-red-950/30",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          className="text-muted-foreground flex items-center gap-1 underline underline-offset-2"
          href={receive.orderHref}
        >
          <LockKeyholeIcon className="h-3 w-3 shrink-0" />
          {receive.orderNumber ?? "View order"}
        </Link>
        <span
          className={cn(
            "font-medium",
            status === "complete" && "text-emerald-700 dark:text-emerald-400",
            status === "partial" && "text-orange-700 dark:text-orange-400",
            status === "problem" && "text-red-700 dark:text-red-400",
            status === "pending" && "text-muted-foreground",
          )}
        >
          {status === "complete"
            ? "All received"
            : status === "partial"
              ? "Part received"
              : status === "problem"
                ? "Problem"
                : "Not received"}
        </span>
        <span className="text-muted-foreground">
          Back ordered {ordered - received}
          {unit}
        </span>
        {receive.badge}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground mr-0.5">Received</span>
        {!locked && (
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label={`One less received: ${name}`}
            disabled={received <= 0}
            onClick={() => setCount(received - 1)}
          >
            <MinusIcon className="h-3.5 w-3.5" />
          </Button>
        )}
        {locked ? (
          <span className="font-semibold tabular-nums">{received}</span>
        ) : (
          <input
            aria-label={`Received: ${name}`}
            type="number"
            inputMode="numeric"
            min={0}
            max={ordered}
            className="border-input bg-card h-7 w-14 rounded-md border px-1.5 text-center text-sm font-semibold tabular-nums"
            value={text ?? String(received)}
            onChange={(event) => setText(event.target.value)}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitText();
              if (event.key === "Escape") setText(null);
            }}
          />
        )}
        {!locked && (
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label={`One more received: ${name}`}
            disabled={received >= ordered}
            onClick={() => setCount(received + 1)}
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </Button>
        )}
        <span className="text-muted-foreground">
          of {ordered}
          {unit}
        </span>
        {!locked && (
          <span className="ml-auto flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              aria-pressed={status === "complete"}
              onClick={() => {
                const next = received >= ordered ? 0 : ordered;
                setProblem(false);
                setReceived(next);
                save(next, false);
              }}
            >
              <CheckIcon className="h-3.5 w-3.5" />
              All
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-7 px-2 text-xs",
                problem && "border-red-400 text-red-700 dark:text-red-400",
              )}
              aria-pressed={problem}
              onClick={() => {
                setProblem(!problem);
                save(received, !problem);
              }}
            >
              <AlertTriangleIcon className="h-3.5 w-3.5" />
              Problem
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
