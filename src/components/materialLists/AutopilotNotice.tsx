"use client";

import { CheckCircle2Icon, Undo2Icon } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { ReceivingReview } from "~/lib/receiving-review";

/** Tells the reviewer a trusted supplier's slip was received without a
 * check, and lets them take it back while nothing has changed since. */
export function AutopilotNotice({
  review,
  orderNumber,
  disabled,
  onUndo,
}: {
  review: ReceivingReview;
  orderNumber?: string | null;
  disabled?: boolean;
  onUndo: () => void;
}) {
  const auto = review.autopilot;
  if (!auto) return null;
  if (auto.undone)
    return review.lines.some((l) => l.approved) ? null : (
      <p
        role="status"
        className="bg-muted text-muted-foreground mb-4 rounded-xl px-4 py-3 text-sm"
      >
        The automatic receipt was undone. Check the lines and approve them
        yourself.
      </p>
    );
  const unchanged = auto.revision === review.revision;
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-emerald-300/70 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100"
    >
      <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Received automatically</p>
        <p>
          {auto.lines} line{auto.lines === 1 ? "" : "s"}
          {orderNumber ? ` on ${orderNumber}` : ""} went onto the order without
          a check. This supplier&apos;s last {auto.trustedAfter} slips needed no
          corrections, and every line here matched.
          {unchanged
            ? " Undo takes the quantities off and puts the lines back to check."
            : " It has changed since, so correct the lines instead of undoing."}
        </p>
      </div>
      {unchanged && (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={onUndo}
        >
          <Undo2Icon />
          Undo
        </Button>
      )}
    </div>
  );
}
