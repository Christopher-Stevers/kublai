"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import type { EstimateStatus } from "~/lib/estimating/types";
import { cn } from "~/lib/utils";

export const selectClass =
  "h-11 min-w-0 max-w-full rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60";
export const actionClass = "bg-blue-600 text-white hover:bg-blue-700";
export const statusLabels: Record<EstimateStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  sent: "Sent",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
};
export function money(value: number, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
export function quantity(value: number) {
  return new Intl.NumberFormat("en-CA", { maximumFractionDigits: 3 }).format(
    value,
  );
}
export function shortDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
export function StatusBadge({ status }: { status: EstimateStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        status === "approved" || status === "won"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : status === "in_review" || status === "sent"
            ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
            : "bg-muted text-muted-foreground",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {statusLabels[status]}
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium [&_input]:max-w-full [&_input]:min-w-0 [&_select]:w-full">
      {label}
      {children}
      {hint && (
        <span className="text-muted-foreground font-normal">{hint}</span>
      )}
    </label>
  );
}
export function NumberInput({
  value,
  onChange,
  nullable = false,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: number | null;
  onChange: (value: number | null) => void;
  nullable?: boolean;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      value={focused ? draft : (value ?? "")}
      onFocus={(event) => {
        setDraft(value === null ? "" : String(value));
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        props.onBlur?.(event);
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        const parsed = Number(raw);
        if (!raw) onChange(nullable ? null : 0);
        else if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed);
      }}
      className={cn(
        "hover:border-border focus:bg-background h-11 w-full min-w-0 rounded border bg-transparent px-2 text-right text-base tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 disabled:opacity-70 sm:text-sm lg:h-8 lg:min-w-16 lg:border-transparent",
        props.className,
      )}
    />
  );
}
export function downloadText(
  name: string,
  text: string,
  type = "text/csv;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The operation could not be completed.";
}

export function MobileFieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-muted-foreground mb-1 block text-[11px] font-medium lg:hidden">
      {children}
    </span>
  );
}
