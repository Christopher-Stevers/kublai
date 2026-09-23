"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent } from "react";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  PlusIcon,
  Trash2Icon,
  WifiOffIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  centsToDecimalString,
  formatCents,
  toCents,
  type DrawLineFigures,
} from "~/lib/draws";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

import { DrawStatusBadge } from "./DrawStatusBadge";

type JobDraws = RouterOutputs["draws"]["getJob"];
type Draw = JobDraws["draws"][number];

function parseMoney(value: string) {
  const num = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(num) ? Math.round(num * 100) : null;
}

/** Text input that keeps local edits and commits on blur or Enter. */
function CommitInput({
  value,
  onCommit,
  disabled,
  className,
  placeholder,
  inputMode,
  ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  inputMode?: "decimal" | "text";
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft.trim() === value) return;
    onCommit(draft.trim());
  };

  return (
    <Input
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      inputMode={inputMode}
      aria-label={ariaLabel}
      className={cn("h-8", className)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function SummaryRow({
  label,
  cents,
  strong,
}: {
  label: string;
  cents: number;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-1 text-sm",
        strong && "border-t pt-2 text-base font-semibold",
      )}
    >
      <span className={cn(!strong && "text-muted-foreground")}>{label}</span>
      <span className="tabular-nums">{formatCents(cents)}</span>
    </div>
  );
}

export function JobDrawsView({ jobId }: { jobId: string }) {
  const isOnline = useOnlineStatus();
  const utils = api.useUtils();
  const { data, isLoading, error } = api.draws.getJob.useQuery(
    { jobId },
    { enabled: isOnline },
  );
  const [selectedDrawId, setSelectedDrawId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newLine, setNewLine] = useState({
    itemNumber: "",
    description: "",
    scheduledValue: "",
  });

  const mutationOptions = {
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        utils.draws.getJob.invalidate({ jobId }),
        utils.draws.listJobs.invalidate(),
      ]);
    },
    onError: (err: { message: string }) => setActionError(err.message),
  };
  const addLine = api.draws.addLine.useMutation({
    ...mutationOptions,
    onSuccess: async () => {
      setNewLine({ itemNumber: "", description: "", scheduledValue: "" });
      await mutationOptions.onSuccess();
    },
  });
  const updateLine = api.draws.updateLine.useMutation(mutationOptions);
  const moveLine = api.draws.moveLine.useMutation(mutationOptions);
  const deleteLine = api.draws.deleteLine.useMutation(mutationOptions);
  const createDraw = api.draws.createDraw.useMutation({
    ...mutationOptions,
    onSuccess: async (draw) => {
      setSelectedDrawId(draw.id);
      await mutationOptions.onSuccess();
    },
  });
  const updateDraw = api.draws.updateDraw.useMutation(mutationOptions);
  const setCompleted = api.draws.setCompleted.useMutation(mutationOptions);
  const setStatus = api.draws.setStatus.useMutation(mutationOptions);
  const deleteDraw = api.draws.deleteDraw.useMutation({
    ...mutationOptions,
    onSuccess: async () => {
      setSelectedDrawId(null);
      await mutationOptions.onSuccess();
    },
  });

  const backLink = (
    <Link
      href="/dashboard/draws"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeftIcon className="h-4 w-4" /> All draws
    </Link>
  );

  if (!isOnline) {
    return (
      <div className="space-y-4">
        {backLink}
        <p className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
          <WifiOffIcon className="h-3 w-3" /> Reconnect to view and edit draws.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading draws...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        {backLink}
        <p className="text-destructive text-sm">
          {error?.message ?? "Unable to load draws."}
        </p>
      </div>
    );
  }

  const { job, lines, draws } = data;
  const latestDraw = draws.at(-1);
  const selectedDraw: Draw | undefined =
    draws.find((draw) => draw.id === selectedDrawId) ?? latestDraw;
  const summary = selectedDraw?.summary;
  const isEditable = selectedDraw?.status === "draft";
  const isLatest = selectedDraw?.id === latestDraw?.id;
  const busy =
    addLine.isPending ||
    updateLine.isPending ||
    moveLine.isPending ||
    deleteLine.isPending ||
    createDraw.isPending ||
    updateDraw.isPending ||
    setCompleted.isPending ||
    setStatus.isPending ||
    deleteDraw.isPending;
  const figuresByLine = new Map<string, DrawLineFigures>(
    summary?.lines.map((line) => [line.lineId, line]) ?? [],
  );
  const contractSumCents = lines.reduce(
    (sum, line) => sum + toCents(line.scheduledValue),
    0,
  );

  const saveCompleted = (lineId: string, completedCents: number) => {
    if (!selectedDraw) return;
    setCompleted.mutate({
      drawId: selectedDraw.id,
      lineId,
      completedToDate: centsToDecimalString(completedCents),
    });
  };

  const submitNewLine = () => {
    if (!newLine.description.trim()) {
      setActionError("Enter a description for the line item.");
      return;
    }
    addLine.mutate({
      jobId,
      itemNumber: newLine.itemNumber,
      description: newLine.description,
      scheduledValue: newLine.scheduledValue || "0",
    });
  };

  return (
    <div className="space-y-5">
      {backLink}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold sm:text-2xl">{job.name}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Contract sum {formatCents(contractSumCents)} across {lines.length}{" "}
            line item{lines.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          onClick={() => createDraw.mutate({ jobId })}
          disabled={
            busy || lines.length === 0 || latestDraw?.status === "draft"
          }
          title={
            latestDraw?.status === "draft"
              ? `Submit draw #${latestDraw.drawNumber} before starting another`
              : lines.length === 0
                ? "Add line items first"
                : undefined
          }
        >
          <PlusIcon /> New draw
        </Button>
      </div>

      {actionError && (
        <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
          {actionError}
        </div>
      )}

      {draws.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {draws.map((draw) => (
            <button
              key={draw.id}
              type="button"
              onClick={() => setSelectedDrawId(draw.id)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm",
                draw.id === selectedDraw?.id
                  ? "border-primary bg-primary/5 font-semibold"
                  : "hover:bg-gray-50",
              )}
            >
              <DrawStatusBadge
                status={draw.status}
                label={`Draw #${draw.drawNumber}`}
              />
            </button>
          ))}
        </div>
      )}

      {selectedDraw && summary && (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-3 rounded-lg border bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold">
                Draw #{selectedDraw.drawNumber}
              </h3>
              <DrawStatusBadge status={selectedDraw.status} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Period ending</span>
                <Input
                  type="date"
                  className="h-9"
                  value={selectedDraw.periodEnd ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    updateDraw.mutate({
                      drawId: selectedDraw.id,
                      periodEnd: event.target.value || null,
                    })
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Retainage %</span>
                <CommitInput
                  ariaLabel="Retainage percent"
                  className="h-9"
                  inputMode="decimal"
                  value={String(Number(selectedDraw.retainagePercent))}
                  disabled={!isEditable || busy}
                  onCommit={(value) => {
                    const percent = Number(value);
                    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
                      setActionError("Retainage must be between 0 and 100.");
                      return;
                    }
                    updateDraw.mutate({
                      drawId: selectedDraw.id,
                      retainagePercent: percent,
                    });
                  }}
                />
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Notes</span>
              <CommitInput
                ariaLabel="Draw notes"
                value={selectedDraw.notes ?? ""}
                placeholder="Optional"
                disabled={busy}
                className="h-9"
                onCommit={(value) =>
                  updateDraw.mutate({
                    drawId: selectedDraw.id,
                    notes: value || null,
                  })
                }
              />
            </label>
            <div className="flex flex-wrap gap-2 pt-1">
              {selectedDraw.status === "draft" && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setStatus.mutate({
                      drawId: selectedDraw.id,
                      status: "submitted",
                    })
                  }
                >
                  Mark submitted
                </Button>
              )}
              {selectedDraw.status === "submitted" && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setStatus.mutate({ drawId: selectedDraw.id, status: "paid" })
                  }
                >
                  Mark paid
                </Button>
              )}
              {selectedDraw.status !== "draft" && isLatest && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    setStatus.mutate({
                      drawId: selectedDraw.id,
                      status: "draft",
                    })
                  }
                >
                  Reopen
                </Button>
              )}
              {selectedDraw.status === "draft" && isLatest && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        `Delete draw #${selectedDraw.drawNumber}? Its amounts will be lost.`,
                      )
                    ) {
                      deleteDraw.mutate({ drawId: selectedDraw.id });
                    }
                  }}
                >
                  <Trash2Icon /> Delete draw
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-white p-4">
            <h3 className="mb-2 font-semibold">Application for payment</h3>
            <SummaryRow
              label="Contract sum"
              cents={summary.contractSumCents}
            />
            <SummaryRow
              label="Completed to date"
              cents={summary.completedToDateCents}
            />
            <SummaryRow
              label={`Retainage (${summary.retainagePercent}%)`}
              cents={-summary.retainageCents}
            />
            <SummaryRow
              label="Earned less retainage"
              cents={summary.earnedLessRetainageCents}
            />
            <SummaryRow
              label="Less previous draws"
              cents={-summary.previousCertificatesCents}
            />
            <SummaryRow
              label="Current payment due"
              cents={summary.currentPaymentDueCents}
              strong
            />
            <p className="text-muted-foreground mt-2 text-xs">
              {summary.percentComplete.toFixed(1)}% complete ·{" "}
              {formatCents(summary.balanceToFinishCents)} left to bill
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-white">
        <div className="border-b px-4 py-3">
          <h3 className="font-semibold">Schedule of values</h3>
          <p className="text-muted-foreground text-xs">
            {selectedDraw
              ? isEditable
                ? "Enter this period's amount or the % complete to date for each line."
                : "Reopen the latest draw to change its amounts."
              : "Add the job's line items, then start draw #1."}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="text-muted-foreground bg-gray-50 text-left text-xs uppercase">
              <tr>
                <th className="w-20 px-2 py-2">Item</th>
                <th className="px-2 py-2">Description</th>
                <th className="w-32 px-2 py-2 text-right">Scheduled</th>
                {summary && (
                  <>
                    <th className="w-28 px-2 py-2 text-right">Previous</th>
                    <th className="w-32 px-2 py-2 text-right">This period</th>
                    <th className="w-28 px-2 py-2 text-right">To date</th>
                    <th className="w-20 px-2 py-2 text-right">%</th>
                    <th className="w-28 px-2 py-2 text-right">Balance</th>
                  </>
                )}
                <th className="w-28 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((line, index) => {
                const figures = figuresByLine.get(line.id);
                return (
                  <tr key={line.id} className="align-middle">
                    <td className="px-2 py-1.5">
                      <CommitInput
                        ariaLabel="Item number"
                        value={line.itemNumber ?? ""}
                        disabled={busy}
                        onCommit={(value) =>
                          updateLine.mutate({
                            lineId: line.id,
                            itemNumber: value,
                          })
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <CommitInput
                        ariaLabel="Description"
                        value={line.description}
                        disabled={busy}
                        onCommit={(value) => {
                          if (!value) {
                            setActionError("Description cannot be empty.");
                            return;
                          }
                          updateLine.mutate({
                            lineId: line.id,
                            description: value,
                          });
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <CommitInput
                        ariaLabel="Scheduled value"
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        value={Number(line.scheduledValue).toFixed(2)}
                        disabled={busy}
                        onCommit={(value) =>
                          updateLine.mutate({
                            lineId: line.id,
                            scheduledValue: value || "0",
                          })
                        }
                      />
                    </td>
                    {summary && figures && (
                      <>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatCents(figures.previousCents)}
                        </td>
                        <td className="px-2 py-1.5">
                          <CommitInput
                            ariaLabel="This period amount"
                            inputMode="decimal"
                            className="text-right tabular-nums"
                            value={(figures.thisPeriodCents / 100).toFixed(2)}
                            disabled={!isEditable || busy}
                            onCommit={(value) => {
                              const cents = parseMoney(value || "0");
                              if (cents === null) {
                                setActionError("Enter a valid amount.");
                                return;
                              }
                              saveCompleted(
                                line.id,
                                figures.previousCents + cents,
                              );
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatCents(figures.completedToDateCents)}
                        </td>
                        <td className="px-2 py-1.5">
                          <CommitInput
                            ariaLabel="Percent complete"
                            inputMode="decimal"
                            className="text-right tabular-nums"
                            value={figures.percentComplete.toFixed(1)}
                            disabled={
                              !isEditable || busy || figures.scheduledCents === 0
                            }
                            onCommit={(value) => {
                              const percent = Number(value || "0");
                              if (
                                !Number.isFinite(percent) ||
                                percent < 0 ||
                                percent > 100
                              ) {
                                setActionError(
                                  "Percent complete must be between 0 and 100.",
                                );
                                return;
                              }
                              saveCompleted(
                                line.id,
                                Math.round(
                                  (figures.scheduledCents * percent) / 100,
                                ),
                              );
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatCents(figures.balanceToFinishCents)}
                        </td>
                      </>
                    )}
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Move up"
                          disabled={busy || index === 0}
                          onClick={() =>
                            moveLine.mutate({
                              lineId: line.id,
                              direction: "up",
                            })
                          }
                        >
                          <ArrowUpIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Move down"
                          disabled={busy || index === lines.length - 1}
                          onClick={() =>
                            moveLine.mutate({
                              lineId: line.id,
                              direction: "down",
                            })
                          }
                        >
                          <ArrowDownIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete line"
                          className="text-destructive"
                          disabled={busy}
                          onClick={() => {
                            if (confirm(`Delete "${line.description}"?`)) {
                              deleteLine.mutate({ lineId: line.id });
                            }
                          }}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              <tr className="bg-gray-50/60">
                <td className="px-2 py-1.5">
                  <Input
                    aria-label="New item number"
                    placeholder="#"
                    className="h-8"
                    value={newLine.itemNumber}
                    onChange={(event) =>
                      setNewLine({ ...newLine, itemNumber: event.target.value })
                    }
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    aria-label="New line description"
                    placeholder="New line item, e.g. Rough-in"
                    className="h-8"
                    value={newLine.description}
                    onChange={(event) =>
                      setNewLine({
                        ...newLine,
                        description: event.target.value,
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitNewLine();
                    }}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    aria-label="New line scheduled value"
                    placeholder="0.00"
                    inputMode="decimal"
                    className="h-8 text-right tabular-nums"
                    value={newLine.scheduledValue}
                    onChange={(event) =>
                      setNewLine({
                        ...newLine,
                        scheduledValue: event.target.value,
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitNewLine();
                    }}
                  />
                </td>
                {summary && <td colSpan={5} />}
                <td className="px-2 py-1.5 text-right">
                  <Button size="sm" disabled={busy} onClick={submitNewLine}>
                    <PlusIcon /> Add
                  </Button>
                </td>
              </tr>
            </tbody>
            <tfoot className="border-t-2 font-semibold">
              <tr>
                <td className="px-2 py-2" colSpan={2}>
                  Total
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {formatCents(contractSumCents)}
                </td>
                {summary && (
                  <>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatCents(
                        summary.completedToDateCents - summary.thisPeriodCents,
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatCents(summary.thisPeriodCents)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatCents(summary.completedToDateCents)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {summary.percentComplete.toFixed(1)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatCents(summary.balanceToFinishCents)}
                    </td>
                  </>
                )}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
