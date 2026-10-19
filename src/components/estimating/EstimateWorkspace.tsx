"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  CopyIcon,
  DownloadIcon,
  HistoryIcon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { api } from "~/trpc/react";
import {
  calculateEstimate,
  estimateDocumentSchema,
  newEstimateDocument,
  type EstimateDocument,
  type EstimateHistoryEntry,
  type EstimateLine,
  type EstimateRecord,
  type EstimateStatus,
} from "~/lib/estimating";
import { Button } from "~/components/ui/button";
import { SaveCheck } from "~/components/ui/save-check";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { confirmAction, notify } from "~/components/ui/app-dialogs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import { useEstimatingPermissions } from "./EstimatingAccess";
import { EstimateLines, isDrawingSourceStale } from "./EstimateLines";
import {
  EstimateAlternates,
  EstimateProposal,
  EstimateSettings,
} from "./EstimateDocumentPanels";
import { PricebookDialog } from "./PricebookDialog";
import { TakeoffSources, type TakeoffProgress } from "./TakeoffSources";
import {
  actionClass,
  downloadText,
  errorMessage,
  money,
  quantity,
  selectClass,
  shortDate,
  StatusBadge,
  statusLabels,
} from "./estimating-ui";

type Tab = "costs" | "scope" | "settings" | "options" | "review";
function calculateForEditor(document: EstimateDocument) {
  try {
    return { calculation: calculateEstimate(document), error: "" };
  } catch (cause) {
    const message = errorMessage(cause);
    const calculation = calculateEstimate(newEstimateDocument());
    calculation.lines = document.lines.map((line) => ({
      ...line,
      demand: 0,
      requiredQuantity: 0,
      purchaseQuantity: 0,
      materialTotal: 0,
      laborHours: 0,
      laborTotal: 0,
      equipmentTotal: 0,
      subcontractTotal: 0,
      otherTotal: 0,
      directCost: 0,
      included: false,
      warnings: [],
    }));
    calculation.issues = [
      { code: "invalid-total", message, severity: "error" },
    ];
    calculation.warnings = [message];
    return { calculation, error: message };
  }
}
const tabs: { id: Tab; label: string }[] = [
  { id: "costs", label: "Takeoff & costs" },
  { id: "scope", label: "Proposal scope" },
  { id: "settings", label: "Pricing settings" },
  { id: "options", label: "Alternates" },
  { id: "review", label: "Review" },
];
const editableStatus = (status: EstimateStatus) =>
  status === "draft" || status === "in_review";
const statusTransitions: Record<EstimateStatus, EstimateStatus[]> = {
  draft: ["in_review", "approved", "archived"],
  in_review: ["draft", "approved", "archived"],
  approved: ["sent", "archived"],
  sent: ["won", "lost", "archived"],
  won: ["archived"],
  lost: ["archived"],
  archived: [],
};

export function EstimateWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const permissions = useEstimatingPermissions();
  const utils = api.useUtils();
  const query = api.estimating.get.useQuery(
    { id },
    { enabled: permissions.allowed, refetchOnWindowFocus: false },
  );
  const [record, setRecord] = useState<EstimateRecord | null>(null);
  const [document, setDocument] = useState<EstimateDocument | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [tab, setTab] = useState<Tab>("costs");
  const [selected, setSelected] = useState<string[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [assignmentLineId, setAssignmentLineId] = useState<
    string | undefined
  >();
  const [pricingOpen, setPricingOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBefore, setHistoryBefore] = useState<number | undefined>();
  const [earlierHistory, setEarlierHistory] = useState<EstimateHistoryEntry[]>(
    [],
  );
  const [progress, setProgress] = useState<TakeoffProgress | null>(null);
  const [nextStatus, setNextStatus] = useState<EstimateStatus>("in_review");
  useEffect(() => {
    if (!record) return;
    const allowed = statusTransitions[record.status].filter((status) =>
      status === "approved" || status === "sent"
        ? permissions.approve
        : permissions.edit,
    );
    if (!allowed.includes(nextStatus) && allowed[0]) setNextStatus(allowed[0]);
  }, [record, permissions.approve, permissions.edit, nextStatus]);
  const currentRecord = useRef<EstimateRecord | null>(null);
  const currentDocument = useRef<EstimateDocument | null>(null);
  const currentName = useRef("");
  const locked = useRef(false);
  const cancelTakeoff = useRef(false);
  useEffect(
    () => () => {
      cancelTakeoff.current = true;
    },
    [],
  );
  const save = api.estimating.save.useMutation();
  const changeStatus = api.estimating.setStatus.useMutation();
  const duplicate = api.estimating.duplicate.useMutation();
  const create = api.estimating.create.useMutation();
  const restore = api.estimating.restore.useMutation();
  const refreshPricing = api.estimating.applyPricing.useMutation();
  const importList = api.estimating.importMaterialList.useMutation();
  const importPrefab = api.estimating.importPrefab.useMutation();
  const analyze = api.estimating.analyzeDrawings.useMutation();
  const handoff = api.estimating.handoffMaterialList.useMutation();
  const [materialsId, setMaterialsId] = useState<string | null>(null);
  const [materialWarnings, setMaterialWarnings] = useState<string[]>([]);
  const resources = api.estimating.resources.useQuery(
    { jobId: record?.jobId ?? "" },
    {
      enabled: permissions.allowed && Boolean(record?.jobId),
      refetchOnWindowFocus: true,
    },
  );
  const history = api.estimating.history.useQuery(
    { id, limit: 50, beforeRevision: historyBefore },
    { enabled: historyOpen && permissions.allowed },
  );
  const accept = useCallback(
    (next: EstimateRecord) => {
      currentRecord.current = next;
      currentDocument.current = next.document;
      currentName.current = next.name;
      setRecord(next);
      setDocument(next.document);
      setName(next.name);
      setConflict(false);
      utils.estimating.get.setData({ id }, next);
    },
    [id, utils.estimating.get],
  );
  useEffect(() => {
    if (query.data && currentRecord.current?.id !== id) accept(query.data);
  }, [query.data, id, accept]);
  const dirty = Boolean(
    record &&
    document &&
    (name !== record.name ||
      JSON.stringify(document) !== JSON.stringify(record.document)),
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || locked.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const updateDocument = (next: EstimateDocument) => {
    if (locked.current) return;
    currentDocument.current = next;
    setDocument(next);
  };
  const updateName = (next: string) => {
    currentName.current = next;
    setName(next);
  };
  const reportError = (cause: unknown) => {
    const text = errorMessage(cause);
    setError(text);
    if (
      (cause as { data?: { code?: string } })?.data?.code === "CONFLICT" ||
      /revision|conflict|changed by/i.test(text)
    )
      setConflict(true);
  };
  const saveCurrent = async () => {
    const latest = currentRecord.current,
      draft = currentDocument.current;
    if (!latest || !draft) throw new Error("Estimate is not loaded.");
    if (
      currentName.current === latest.name &&
      JSON.stringify(draft) === JSON.stringify(latest.document)
    )
      return latest;
    if (!permissions.edit || !editableStatus(latest.status))
      throw new Error(
        "This estimate is locked. Duplicate it or restore a revision to continue editing.",
      );
    const parsed = estimateDocumentSchema.safeParse(draft);
    if (!parsed.success)
      throw new Error(
        `Check your cost rows and settings: ${parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    if (!currentName.current.trim())
      throw new Error("Enter an estimate name before saving.");
    calculateEstimate(parsed.data);
    const next = await save.mutateAsync({
      id,
      expectedRevision: latest.revision,
      name: currentName.current.trim(),
      document: parsed.data,
    });
    accept(next);
    return next;
  };
  const run = async (
    label: string,
    action?: (latest: EstimateRecord) => Promise<EstimateRecord | void>,
  ) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(label);
    setError("");
    try {
      const latest = await saveCurrent();
      const next = await action?.(latest);
      if (next) accept(next);
      await Promise.all([
        utils.estimating.list.invalidate(),
        utils.estimating.history.invalidate({ id }),
      ]);
      setHistoryBefore(undefined);
      setEarlierHistory([]);
      if (label === "Saving") notify("Estimate saved.", "success");
    } catch (cause) {
      reportError(cause);
    } finally {
      locked.current = false;
      setBusy("");
    }
  };
  const reload = async () => {
    if (locked.current) return;
    if (
      dirty &&
      !(await confirmAction({
        title: "Reload current estimate?",
        description:
          "This discards your unsaved edits. Download your working copy or save it as a new estimate first.",
        confirmLabel: "Reload",
        destructive: true,
      }))
    )
      return;
    const result = await query.refetch();
    if (result.data) {
      accept(result.data);
      setError("");
      setSelected([]);
    }
  };
  const saveCopy = async () => {
    if (locked.current || !record || !document) return;
    locked.current = true;
    setBusy("Saving copy");
    setError("");
    try {
      const parsed = estimateDocumentSchema.parse(document);
      const copy = await create.mutateAsync({
        jobId: record.jobId,
        name: `${(name.trim() || record.name).slice(0, 235)} — working copy`,
        document: parsed,
      });
      router.push(`/dashboard/estimating/${copy.id}`);
    } catch (cause) {
      reportError(cause);
    } finally {
      locked.current = false;
      setBusy("");
    }
  };
  const approveEvidence = async (ids = selected) => {
    if (!document || locked.current || !ids.length) return;
    const rows = document.lines.filter((line) => ids.includes(line.id));
    if (
      !(await confirmAction({
        title: `Approve evidence for ${rows.length} row${rows.length === 1 ? "" : "s"}?`,
        description:
          "Confirm you checked the source quantities, units, and scope against the drawings or material evidence. This marks the selected evidence reviewed; missing, simulated, or stale pricing still requires correction.",
        confirmLabel: "Evidence reviewed",
      }))
    )
      return;
    updateDocument({
      ...document,
      lines: document.lines.map((line) =>
        ids.includes(line.id) ? { ...line, reviewStatus: "approved" } : line,
      ),
    });
  };
  const addLines = (lines: EstimateLine[]) => {
    if (!currentDocument.current || locked.current) return;
    if (assignmentLineId && lines[0]) {
      const part = lines[0];
      updateDocument({
        ...currentDocument.current,
        lines: currentDocument.current.lines.map((line) =>
          line.id === assignmentLineId
            ? {
                ...line,
                description: part.description,
                partDefinitionId: part.partDefinitionId,
                supplierPartId: part.supplierPartId,
                supplierName: part.supplierName,
                materialUnitCost: part.materialUnitCost,
                laborHoursPerUnit: part.laborHoursPerUnit,
                equipmentUnitCost: part.equipmentUnitCost,
                subcontractUnitCost: part.subcontractUnitCost,
                otherUnitCost: part.otherUnitCost,
                priceSource: part.priceSource,
                priceCurrency: part.priceCurrency,
                priceUpdatedAt: part.priceUpdatedAt,
                orderMultiple: part.orderMultiple,
                costCode: part.costCode,
                trade: part.trade,
                reviewStatus: "unreviewed",
              }
            : line,
        ),
      });
      setSourcesOpen(false);
      setAssignmentLineId(undefined);
      notify(
        "Material assigned. Measured quantity and drawing evidence are retained.",
        "success",
      );
      return;
    }
    updateDocument({
      ...currentDocument.current,
      lines: [...currentDocument.current.lines, ...lines],
    });
    notify(
      `${lines.length} cost row${lines.length === 1 ? "" : "s"} added. Save to retain these changes.`,
      "success",
    );
  };
  const analyzeSheets = (sheetIds: string[], includeRooms: boolean) => {
    if (locked.current || !sheetIds.length) return;
    cancelTakeoff.current = false;
    setProgress({
      completed: 0,
      total: sheetIds.length,
      running: true,
      cancelled: false,
    });
    void run("Analyzing drawings", async (latest) => {
      let next = latest;
      let completed = 0;
      try {
        for (let index = 0; index < sheetIds.length; index += 5) {
          if (cancelTakeoff.current) break;
          const chunk = sheetIds.slice(index, index + 5);
          next = await analyze.mutateAsync({
            id,
            expectedRevision: next.revision,
            sheetIds: chunk,
            includeRooms,
          });
          accept(next);
          completed += chunk.length;
          setProgress({
            completed,
            total: sheetIds.length,
            running: true,
            cancelled: false,
          });
        }
      } finally {
        setProgress({
          completed,
          total: sheetIds.length,
          running: false,
          cancelled: cancelTakeoff.current || completed < sheetIds.length,
        });
      }
      return next;
    });
  };

  const calculated = useMemo(
    () => (document ? calculateForEditor(document) : null),
    [document],
  );
  const calculation = calculated?.calculation;
  const calculationError = calculated?.error ?? "";
  if (query.isLoading || !record || !document || !calculation)
    return (
      <div className="p-6">
        <p
          role={query.error ? "alert" : "status"}
          className="text-muted-foreground text-sm"
        >
          {query.error?.message ?? "Loading estimate…"}
        </p>
        {query.error && (
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        )}
      </div>
    );
  const total = calculation.total;
  const currency = document.settings.currency;
  const displayMoney = (value: number) =>
    calculationError ? "—" : money(value, currency);
  const historyItems = [
    ...new Map(
      [...earlierHistory, ...(history.data?.items ?? [])].map((event) => [
        event.id,
        event,
      ]),
    ).values(),
  ];
  const writable = permissions.edit && editableStatus(record.status);
  const disabled = !writable || Boolean(busy);
  const sheets = resources.data?.sheets ?? [];
  const drawingChanges = document.lines.filter((line) => {
    const sheet = sheets.find((sheet) => sheet.id === line.source.sheetId);
    return (
      calculation.lines.some((row) => row.id === line.id && row.included) &&
      isDrawingSourceStale(line, sheet)
    );
  });
  const otherUnreviewed = calculation.lines.filter(
    (line) =>
      line.included &&
      line.quantity * line.multiplier > 0 &&
      line.source.kind !== "manual" &&
      line.reviewStatus !== "approved" &&
      !calculation.issues.some(
        (issue) =>
          issue.lineId === line.id && issue.code === "unreviewed-source",
      ),
  );
  const issueCount =
    calculation.issues.length + drawingChanges.length + otherUnreviewed.length;
  const ready =
    calculation.readiness.ready &&
    !drawingChanges.length &&
    !otherUnreviewed.length;
  const statusOptions = statusTransitions[record.status].filter((status) =>
    status === "approved" || status === "sent"
      ? permissions.approve
      : permissions.edit,
  );
  const breakdown = [
    { label: "Materials", value: total.materialTotal },
    {
      label: `Labor · ${quantity(total.laborHours)} hr`,
      value: total.laborTotal,
    },
    { label: "Equipment", value: total.equipmentTotal },
    { label: "Subcontract", value: total.subcontractTotal },
    { label: "Other costs", value: total.otherTotal },
  ];
  return (
    <div className="mx-auto w-full max-w-[1920px] min-w-0 px-3 py-5 sm:px-6 lg:px-8">
      <div className="mb-5">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground mb-3 -ml-2 h-9"
          disabled={Boolean(busy)}
          onClick={async () => {
            if (
              !dirty ||
              (await confirmAction({
                title: "Leave unsaved estimate?",
                description:
                  "Save your changes or download a working copy before leaving.",
                confirmLabel: "Leave",
                destructive: true,
              }))
            )
              router.push("/dashboard/estimating");
          }}
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Estimates
        </Button>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Input
              aria-label="Estimate name"
              value={name}
              disabled={disabled}
              onChange={(event) => updateName(event.target.value)}
              maxLength={255}
              className="hover:border-border focus:bg-background h-auto w-full min-w-0 border-transparent bg-transparent px-0 py-0.5 text-2xl font-bold shadow-none sm:text-3xl md:text-3xl dark:bg-transparent"
            />
            <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
              <StatusBadge status={record.status} />
              <span>
                {record.jobName} · Revision {record.revision} · Updated{" "}
                {shortDate(record.updatedAt)}
                {record.createdByName ? ` · ${record.createdByName}` : ""}
              </span>
              <span
                role="status"
                className={cn(
                  "inline-flex items-center gap-1",
                  dirty && !busy && "text-amber-700 dark:text-amber-300",
                )}
              >
                {busy ? (
                  <RefreshCwIcon className="h-3 w-3 animate-spin" />
                ) : dirty ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                ) : (
                  <SaveCheck className="size-3.5" />
                )}
                {busy
                  ? `${busy}…`
                  : dirty
                    ? "Unsaved changes"
                    : "All changes saved"}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              className="hidden sm:inline-flex"
              disabled={Boolean(busy)}
              onClick={() => {
                setHistoryBefore(undefined);
                setEarlierHistory([]);
                setHistoryOpen(true);
              }}
            >
              <HistoryIcon className="h-4 w-4" />
              History
            </Button>
            <Button
              variant="outline"
              className="hidden sm:inline-flex"
              disabled={!permissions.edit || Boolean(busy)}
              onClick={() =>
                void run("Duplicating", async (latest) => {
                  const copy = await duplicate.mutateAsync({ id: latest.id });
                  router.push(`/dashboard/estimating/${copy.id}`);
                })
              }
            >
              <CopyIcon className="h-4 w-4" />
              Duplicate
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 sm:hidden"
                  aria-label="More estimate actions"
                  disabled={Boolean(busy)}
                >
                  <MoreVerticalIcon className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setHistoryBefore(undefined);
                    setEarlierHistory([]);
                    setHistoryOpen(true);
                  }}
                >
                  <HistoryIcon className="h-4 w-4" />
                  History
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!permissions.edit}
                  onSelect={() =>
                    void run("Duplicating", async (latest) => {
                      const copy = await duplicate.mutateAsync({
                        id: latest.id,
                      });
                      router.push(`/dashboard/estimating/${copy.id}`);
                    })
                  }
                >
                  <CopyIcon className="h-4 w-4" />
                  Duplicate
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {writable && (
              <Button
                className={`${actionClass} h-11 sm:h-9`}
                aria-label="Save changes"
                disabled={!dirty || Boolean(busy)}
                onClick={() => void run("Saving")}
              >
                <SaveIcon className="h-4 w-4" />
                <span className="sm:hidden">Save</span>
                <span className="hidden sm:inline">Save changes</span>
              </Button>
            )}
          </div>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 mb-4 space-y-3 rounded-md border p-4"
        >
          <p className="text-destructive text-sm">{error}</p>
          <p className="text-muted-foreground text-xs">
            Your unsaved changes remain in this workspace.
          </p>
          {conflict && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadText(
                    `${name || "estimate"}-working-copy.json`,
                    JSON.stringify({ name, document }, null, 2),
                    "application/json",
                  )
                }
              >
                Download working copy
              </Button>
              {permissions.edit && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={() => void saveCopy()}
                >
                  Save as new estimate
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(busy)}
                onClick={() => void reload()}
              >
                Reload current revision
              </Button>
            </div>
          )}
        </div>
      )}
      {!editableStatus(record.status) && (
        <p className="bg-muted/30 text-muted-foreground mb-4 rounded-md border px-4 py-3 text-sm">
          This {statusLabels[record.status].toLowerCase()} revision is locked.
          Duplicate it or restore a historical revision to create an editable
          draft.
        </p>
      )}
      {calculationError && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive mb-4 rounded-md border p-4 text-sm"
        >
          {calculationError} Adjust the cost values to calculate and save this
          estimate. Your editable rows are retained.
        </p>
      )}
      <section
        aria-label="Estimate total"
        className="bg-card mb-4 flex min-w-0 items-center justify-between gap-3 rounded-xl border p-4 shadow-sm xl:hidden"
      >
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">
            Selling price · {currency}
          </p>
          <p className="text-2xl font-bold break-words tabular-nums">
            {displayMoney(total.total)}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-11 shrink-0"
          aria-expanded={showSummary}
          aria-controls="estimate-summary"
          onClick={() => setShowSummary(!showSummary)}
        >
          {showSummary ? "Hide totals" : "Totals & actions"}
        </Button>
      </section>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <main className="bg-card min-w-0 overflow-hidden rounded-xl border shadow-sm">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b px-3 pt-3">
            <div
              role="tablist"
              aria-label="Estimate section"
              className="-mx-3 flex w-[calc(100%+1.5rem)] gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:px-0"
            >
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "focus-visible:ring-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    tab === item.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {item.label}
                  {item.id === "review" && issueCount > 0 && (
                    <span className="min-w-5 rounded-full bg-amber-500 px-1.5 text-center text-[11px] leading-5 font-bold text-white">
                      {issueCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="mb-3 flex w-full gap-2 sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                className="h-11 flex-1 sm:h-9 sm:flex-none"
                disabled={disabled}
                onClick={() => {
                  setAssignmentLineId(undefined);
                  setSourcesOpen(true);
                }}
              >
                <PlusIcon className="h-4 w-4" />
                Add takeoff
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Organization pricebook"
                className="h-11 w-11 sm:h-9 sm:w-9"
                onClick={() => setPricingOpen(true)}
              >
                <SlidersHorizontalIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {tab === "costs" && (
            <EstimateLines
              document={document}
              lines={calculation.lines}
              jobId={record.jobId}
              sheets={sheets}
              disabled={disabled}
              canDrawings={permissions.drawings}
              selected={selected}
              onSelected={setSelected}
              onChange={updateDocument}
              onApprove={(ids) => void approveEvidence(ids)}
              onAssembly={() => setPricingOpen(true)}
              onAssignMaterial={(lineId) => {
                setAssignmentLineId(lineId);
                setSourcesOpen(true);
              }}
              calculationValid={!calculationError}
            />
          )}
          {tab === "scope" && (
            <EstimateProposal
              document={document}
              disabled={disabled}
              onChange={updateDocument}
            />
          )}
          {tab === "settings" && (
            <EstimateSettings
              document={document}
              disabled={disabled}
              onChange={updateDocument}
            />
          )}
          {tab === "options" && (
            <EstimateAlternates
              document={document}
              disabled={disabled}
              onChange={updateDocument}
            />
          )}
          {tab === "review" && (
            <section className="p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Estimate review</h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Resolve pricing and source evidence before approval.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    void run("Refreshing pricing", (latest) =>
                      refreshPricing.mutateAsync({
                        id,
                        expectedRevision: latest.revision,
                      }),
                    )
                  }
                >
                  <RefreshCwIcon className="mr-1.5 h-4 w-4" />
                  Refresh pricing
                </Button>
              </div>
              {resources.error && (
                <p role="alert" className="text-destructive mb-3 text-sm">
                  Drawing revisions could not be checked:{" "}
                  {resources.error.message}
                </p>
              )}
              {ready ? (
                <p className="flex items-center gap-2 border-y py-6 text-sm text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2Icon className="h-4 w-4" />
                  Included costs have prices and reviewed source evidence.
                </p>
              ) : (
                <div className="divide-y">
                  {calculation.issues.map((issue, index) => (
                    <button
                      key={index}
                      className="hover:text-primary flex w-full items-start gap-3 py-3 text-left text-sm"
                      onClick={() => {
                        if (issue.lineId) setSelected([issue.lineId]);
                        setTab("costs");
                      }}
                    >
                      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <span>{issue.message}</span>
                    </button>
                  ))}
                  {drawingChanges.map((line) => (
                    <button
                      key={line.id}
                      className="hover:text-primary flex w-full items-start gap-3 py-3 text-left text-sm"
                      onClick={() => {
                        setSelected([line.id]);
                        setTab("costs");
                      }}
                    >
                      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <span>
                        {line.description}: drawing revision has changed.
                        Recheck the source quantity and scope.
                      </span>
                    </button>
                  ))}
                  {otherUnreviewed.map((line) => (
                    <button
                      key={`review-${line.id}`}
                      className="hover:text-primary flex w-full items-start gap-3 py-3 text-left text-sm"
                      onClick={() => {
                        setSelected([line.id]);
                        setTab("costs");
                      }}
                    >
                      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <span>
                        {line.description}: imported scope evidence needs
                        review.
                      </span>
                    </button>
                  ))}
                  {!document.lines.length && (
                    <p className="text-muted-foreground py-8 text-sm">
                      Add at least one included cost row to begin review.
                    </p>
                  )}
                </div>
              )}
              <h3 className="mt-8 mb-2 text-sm font-semibold">
                Included direct cost by trade
              </h3>
              <table className="w-full table-fixed text-sm">
                <tbody className="divide-y">
                  {calculation.groups.trade.map((group) => (
                    <tr key={group.name}>
                      <td className="py-2 pr-2 break-words">
                        {group.name}
                        <span className="text-muted-foreground ml-2 text-xs">
                          {group.lineCount} rows
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {displayMoney(group.directCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {document.assumptions && (
                <div className="mt-6 border-t pt-4">
                  <h3 className="mb-2 text-sm font-semibold">
                    Drawing limitations & assumptions
                  </h3>
                  <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap">
                    {document.assumptions}
                  </p>
                  <Button
                    variant="link"
                    className="mt-2 h-auto px-0 text-xs"
                    onClick={() => setTab("scope")}
                  >
                    Review proposal assumptions
                  </Button>
                </div>
              )}
            </section>
          )}
        </main>
        <aside
          id="estimate-summary"
          className={`${showSummary ? "block" : "hidden"} order-first min-w-0 space-y-4 xl:sticky xl:top-20 xl:order-last xl:block xl:self-start`}
        >
          <section className="bg-card overflow-hidden rounded-xl border shadow-sm">
            <div className="bg-muted/30 border-b p-5">
              <p className="text-muted-foreground text-xs font-medium">
                Selling price · {currency}
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-tight break-words tabular-nums">
                {displayMoney(total.total)}
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                {calculationError
                  ? `${document.lines.length} rows · Totals unavailable`
                  : `${calculation.lines.filter((line) => line.included).length} included rows · ${quantity(total.laborHours)} labor hours`}
              </p>
            </div>
            <div className="space-y-2 p-5 text-xs">
              {breakdown.map((item) => (
                <div
                  key={item.label}
                  className="flex min-w-0 justify-between gap-3 [&>span]:min-w-0 [&>span]:break-words"
                >
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="tabular-nums">
                    {displayMoney(item.value)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-3 font-semibold">
                <span>Direct cost</span>
                <span className="tabular-nums">
                  {displayMoney(total.directCost)}
                </span>
              </div>
              {[
                {
                  label: `Overhead ${document.settings.overheadPercent}%`,
                  value: total.overhead,
                },
                {
                  label: `Contingency ${document.settings.contingencyPercent}%`,
                  value: total.contingency,
                },
                {
                  label: `${document.settings.profitMode === "margin" ? "Margin" : "Markup"} ${document.settings.profitPercent}%`,
                  value: total.profit,
                },
                {
                  label: `Tax ${document.settings.taxPercent}%`,
                  value: total.tax,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex min-w-0 justify-between gap-3 [&>span]:min-w-0 [&>span]:break-words"
                >
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="tabular-nums">
                    {displayMoney(item.value)}
                  </span>
                </div>
              ))}
            </div>
            {calculation.alternates.length > 0 && (
              <div className="border-t px-5 py-3 text-xs">
                <p className="mb-2 font-semibold">Alternate options</p>
                {calculation.alternates.map((alternate) => (
                  <div
                    key={alternate.id}
                    className="mb-2 flex justify-between gap-3"
                  >
                    <span className="text-muted-foreground">
                      {alternate.name}
                      {alternate.included ? " · Included" : ""}
                    </span>
                    <span className="whitespace-nowrap tabular-nums">
                      +{displayMoney(alternate.incrementalTotal)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button
              className="hover:bg-muted/30 flex w-full items-center gap-2 border-t px-5 py-3 text-left text-xs"
              onClick={() => setTab("review")}
            >
              {ready ? (
                <CheckCircle2Icon className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangleIcon className="h-4 w-4 text-amber-600" />
              )}
              {ready
                ? "Ready for approval"
                : `${issueCount} review item${issueCount === 1 ? "" : "s"}`}
            </button>
          </section>
          {permissions.edit &&
            permissions.listsEdit &&
            (record.status === "approved" || record.status === "won") && (
              <section className="bg-card rounded-xl border p-4 shadow-sm">
                <h3 className="mb-2 text-sm font-semibold">
                  Material planning
                </h3>
                <p className="text-muted-foreground mb-3 text-xs">
                  Prepare the included catalogue materials for purchasing
                  review.
                </p>
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("Preparing materials", async (latest) => {
                      const result = await handoff.mutateAsync({
                        id,
                        expectedRevision: latest.revision,
                      });
                      setMaterialsId(result.materialListId);
                      setMaterialWarnings(result.warnings);
                      return result.estimate;
                    })
                  }
                >
                  {materialsId
                    ? "Open prepared materials"
                    : "Prepare materials"}
                </Button>
                {materialsId && (
                  <a
                    className="text-primary mt-2 block text-xs underline"
                    href={`/dashboard/material-lists/${materialsId}`}
                  >
                    View material list
                  </a>
                )}
                {materialWarnings.map((warning, index) => (
                  <p key={index} className="text-muted-foreground mt-2 text-xs">
                    {warning}
                  </p>
                ))}
              </section>
            )}
          {statusOptions.length > 0 && (
            <section className="bg-card rounded-xl border p-4 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold">Workflow status</h3>
              <div className="flex gap-2">
                <select
                  className={`${selectClass} min-w-0 flex-1`}
                  aria-label="Next workflow status"
                  value={nextStatus}
                  onChange={(event) =>
                    setNextStatus(event.target.value as EstimateStatus)
                  }
                  disabled={Boolean(busy)}
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    Boolean(busy) ||
                    ((nextStatus === "approved" || nextStatus === "sent") &&
                      (!permissions.approve || !ready)) ||
                    nextStatus === record.status
                  }
                  onClick={async () => {
                    if (
                      nextStatus === "approved" &&
                      !(await confirmAction({
                        title: "Approve this estimate?",
                        description:
                          "Confirm the pricing, quantities, assumptions, and proposal scope are ready. Approval locks this revision.",
                        confirmLabel: "Approve estimate",
                      }))
                    )
                      return;
                    void run("Updating status", (latest) =>
                      changeStatus.mutateAsync({
                        id,
                        expectedRevision: latest.revision,
                        status: nextStatus,
                      }),
                    );
                  }}
                >
                  Update
                </Button>
              </div>
            </section>
          )}
          <section className="bg-card rounded-xl border p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold">Reports & proposal</h3>
            {dirty && (
              <p className="text-muted-foreground mb-3 text-xs">
                Save changes to export the current working estimate.
              </p>
            )}
            <div className="space-y-2">
              {[
                {
                  label: "Customer proposal · PDF",
                  format: "pdf",
                  view: "proposal",
                },
                {
                  label: "Internal cost report · PDF",
                  format: "pdf",
                  view: "internal",
                },
                {
                  label: "Cost workbook · Excel",
                  format: "xlsx",
                  view: "internal",
                },
                { label: "Cost rows · CSV", format: "csv", view: "internal" },
              ].map((exportItem) => (
                <Button
                  key={exportItem.label}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-xs"
                  disabled={dirty || Boolean(busy) || Boolean(calculationError)}
                  asChild={!dirty && !busy && !calculationError}
                >
                  {!dirty && !busy && !calculationError ? (
                    <a
                      href={`/api/estimating/${id}/export?format=${exportItem.format}&view=${exportItem.view}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <DownloadIcon className="mr-2 h-3.5 w-3.5" />
                      {exportItem.label}
                    </a>
                  ) : (
                    <span>
                      <DownloadIcon className="mr-2 h-3.5 w-3.5" />
                      {exportItem.label}
                    </span>
                  )}
                </Button>
              ))}
            </div>
          </section>
        </aside>
      </div>
      <TakeoffSources
        open={sourcesOpen}
        onOpenChange={(open) => {
          setSourcesOpen(open);
          if (!open) setAssignmentLineId(undefined);
        }}
        assignmentLine={document.lines.find(
          (line) => line.id === assignmentLineId,
        )}
        document={document}
        jobId={record.jobId}
        sheets={sheets}
        materialLists={resources.data?.materialLists ?? []}
        prefabs={resources.data?.prefabs ?? []}
        disabled={disabled}
        canDrawings={permissions.drawings}
        onChange={updateDocument}
        onAddLines={addLines}
        onMaterialList={(materialListId) =>
          void run("Importing material list", (latest) =>
            importList.mutateAsync({
              id,
              expectedRevision: latest.revision,
              materialListId,
            }),
          )
        }
        onPrefab={(prefabId, prefabQuantity) =>
          void run("Importing prefab", (latest) =>
            importPrefab.mutateAsync({
              id,
              expectedRevision: latest.revision,
              prefabId,
              quantity: prefabQuantity,
            }),
          )
        }
        onAnalyze={analyzeSheets}
        progress={progress}
        onCancel={() => {
          cancelTakeoff.current = true;
        }}
      />
      <PricebookDialog
        open={pricingOpen}
        onOpenChange={setPricingOpen}
        canEdit={permissions.edit}
        assemblyLines={document.lines.filter(
          (line) =>
            selected.includes(line.id) && line.reviewStatus !== "excluded",
        )}
        onSaved={() => {
          void utils.estimating.pricing.invalidate();
        }}
      />
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[88svh] min-w-0 overflow-auto p-4 sm:max-w-3xl sm:p-6">
          <DialogHeader>
            <DialogTitle>Revision history</DialogTitle>
            <DialogDescription>
              Every saved version retains its scope, prices, actor, and workflow
              status. Restoring creates a new draft.
            </DialogDescription>
          </DialogHeader>
          {history.isLoading && (
            <p role="status" className="text-muted-foreground py-8 text-sm">
              Loading revision history…
            </p>
          )}
          {history.error && (
            <p role="alert" className="text-destructive text-sm">
              {history.error.message}
            </p>
          )}
          <div className="divide-y">
            {historyItems.map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap items-center gap-3 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Revision {event.revision} · {event.name}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {event.actorName || "Organization member"} ·{" "}
                    {shortDate(event.createdAt)} · {event.action}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {event.summary.lineCount} rows ·{" "}
                    {money(event.summary.total, event.summary.currency)}
                  </p>
                </div>
                <StatusBadge status={event.status} />
                {permissions.edit && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(busy)}
                    onClick={async () => {
                      if (
                        !(await confirmAction({
                          title: `Restore revision ${event.revision}?`,
                          description:
                            "The restored document becomes a new editable draft. Current unsaved changes will be saved first.",
                          confirmLabel: "Restore draft",
                        }))
                      )
                        return;
                      void run("Restoring revision", (latest) =>
                        restore.mutateAsync({
                          id,
                          expectedRevision: latest.revision,
                          eventId: event.id,
                        }),
                      );
                    }}
                  >
                    Restore
                  </Button>
                )}
              </div>
            ))}
          </div>
          {history.data?.nextBeforeRevision !== null &&
            history.data?.nextBeforeRevision !== undefined && (
              <Button
                variant="outline"
                disabled={history.isFetching || Boolean(busy)}
                onClick={() => {
                  if (
                    history.data?.nextBeforeRevision !== null &&
                    history.data?.nextBeforeRevision !== undefined
                  ) {
                    setEarlierHistory(historyItems);
                    setHistoryBefore(history.data.nextBeforeRevision);
                  }
                }}
              >
                {history.isFetching ? "Loading…" : "Load earlier revisions"}
              </Button>
            )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
