"use client";
import { parseJobPrice } from "~/lib/job-pricing";
import { use, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Download, Search, Upload, X } from "lucide-react";
import { api, type RouterOutputs } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { useJobPricing } from "~/hooks/use-job-pricing";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useFinancialVisibility } from "~/components/permissions/FinancialVisibility";

type Entry = RouterOutputs["jobPricing"]["get"]["entries"][number];
type Request = RouterOutputs["jobPricing"]["approvals"][number];
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value).trim();
  throw new Error("The price file contains an unsupported cell value.");
}
const money = (cost: string | null) =>
  cost === null
    ? "Price needed"
    : new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
      }).format(Number(cost));

export default function JobPricingPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);
  const online = useOnlineStatus();
  const showMoney = useFinancialVisibility();
  const { data, isLoading, error, refetch } = useJobPricing(jobId);
  const utils = api.useUtils();
  const requests = api.jobPricing.approvals.useQuery(
    { jobId },
    {
      enabled: online,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    },
  );
  const [tab, setTab] = useState<"parts" | "approvals">("parts");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<Entry | null>(null);
  const [editingRevision, setEditingRevision] = useState(0);
  const [price, setPrice] = useState("");
  const [status, setStatus] = useState<"estimated" | "confirmed" | "none">(
    "estimated",
  );
  const [source, setSource] = useState("");
  const [review, setReview] = useState<Request | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<Array<{
    entryId: string;
    unitCost: number | null;
    priceStatus: "estimated" | "confirmed" | "none";
    priceSource: string;
  }> | null>(null);
  const [importRevision, setImportRevision] = useState(0);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [partSearch, setPartSearch] = useState("");
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const found = api.catalogue.searchParts.useQuery(
    { query: partSearch },
    { enabled: online && adding && partSearch.trim().length > 1 },
  );
  const part = api.supplier.getSupplierPartsByPart.useQuery(
    { partDefinitionId: selectedPart ?? "" },
    { enabled: !!selectedPart && online },
  );
  const invalidate = async () => {
    await Promise.all([
      refetch(),
      requests.refetch(),
      utils.materialList.previewOrders.invalidate(),
    ]);
  };
  const save = api.jobPricing.savePrices.useMutation({
    onSuccess: async () => {
      setEditing(null);
      setImportRows(null);
      setMessage("Prices saved. Sent orders retain their original prices.");
      await invalidate();
    },
    onError: (e) => setMessage(e.message),
  });
  const decide = api.jobPricing.reviewApproval.useMutation({
    onSuccess: async () => {
      setReview(null);
      setMessage("Review recorded.");
      await invalidate();
    },
    onError: (e) => setMessage(e.message),
  });
  const add = api.jobPricing.addListing.useMutation({
    onSuccess: async () => {
      setAdding(false);
      setMessage("Supplier listing added to this job.");
      await invalidate();
    },
    onError: (e) => setMessage(e.message),
  });
  const rows = useMemo(() => {
    const term = search.toLowerCase().trim();
    return (data?.entries ?? []).filter(
      (e) =>
        (filter === "all" || e.priceStatus === filter) &&
        (!term ||
          `${e.displayName} ${e.supplierSku} ${e.sourceDescription}`
            .toLowerCase()
            .includes(term)),
    );
  }, [data, search, filter]);
  const pending = (requests.data ?? []).filter((r) => r.status === "pending");
  function exportRows() {
    const values = [
      [
        "Entry ID",
        "Supplier",
        "Supplier SKU",
        "ForemanHQ part",
        "Supplier description",
        "Unit cost CAD",
        "Price status",
        "Price basis",
        "Price source",
      ],
      ...(data?.entries ?? []).map((e) => [
        e.id,
        e.supplierName,
        e.supplierSku,
        e.displayName,
        e.sourceDescription,
        showMoney ? e.unitCost : null,
        e.priceStatus,
        e.priceBasis,
        e.priceSource,
      ]),
    ];
    const csv =
      "\ufeff" +
      values
        .map((row) =>
          row
            .map(
              (v) =>
                `"${String(v ?? "")
                  .replaceAll('"', '""')
                  .replace(/^[=+@-]/, "'$&")}"`,
            )
            .join(","),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data?.job.name ?? "Job"}-pricing.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function readPrices(upload: File) {
    setImporting(true);
    setMessage("");
    try {
      if (upload.size > 10_000_000)
        throw new Error("Use a price file smaller than 10 MB.");
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await upload.arrayBuffer(), {
        type: "array",
        sheetRows: 1002,
        cellFormula: false,
      });
      const sheet = wb.Sheets[wb.SheetNames[0] ?? ""];
      if (!sheet) throw new Error("No sheet found.");
      const imported = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        sheet,
        { defval: "" },
      );
      if (!imported.length || imported.length > 1000)
        throw new Error("Use between 1 and 1,000 pricing rows.");
      const ids = new Set<string>();
      const changes = imported.map((r, index) => {
        const sku = cellText(r["Supplier SKU"]);
        const entryId = cellText(r["Entry ID"]);
        const candidates = (data?.entries ?? []).filter(
          (e) =>
            e.supplierSku?.toLowerCase() === sku.toLowerCase() &&
            (!entryId || e.id === entryId),
        );
        if (candidates.length !== 1)
          throw new Error(
            `Row ${index + 2}: SKU ${sku || "(blank)"} must match exactly one listing in this job.`,
          );
        const entry = candidates[0]!;
        if (ids.has(entry.id)) throw new Error(`Duplicate SKU: ${sku}`);
        ids.add(entry.id);
        const raw = cellText(r["Unit cost CAD"]);
        const cost = parseJobPrice(raw);
        if (
          cost !== null &&
          (!Number.isFinite(cost) || cost < 0 || cost > 99999999)
        )
          throw new Error(`Invalid CAD price for ${sku}.`);
        const requested = cellText(r["Price status"] ?? "estimated")
          .toLowerCase()
          .trim();
        if (!["estimated", "confirmed", "none"].includes(requested))
          throw new Error(`Invalid price status for ${sku}.`);
        const priceStatus =
          cost === null
            ? "none"
            : (requested as "estimated" | "confirmed" | "none");
        if (priceStatus === "none" && cost !== null)
          throw new Error(
            `${sku}: choose estimated or confirmed for a supplied price.`,
          );
        return {
          entryId: entry.id,
          unitCost: cost,
          priceStatus,
          priceSource:
            cellText(r["Price source"]) ||
            `Imported from ${upload.name} on ${new Date().toLocaleDateString("en-CA")}`,
        };
      });
      setImportRevision(data?.policy?.revision ?? 0);
      setImportRows(changes);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to read prices.");
    } finally {
      setImporting(false);
      if (file.current) file.current.value = "";
    }
  }
  if (isLoading)
    return (
      <div className="text-muted-foreground p-6">Loading job pricing…</div>
    );
  if (error || !data)
    return (
      <div className="p-6" role="alert">
        {error?.message ?? "Connect to load job pricing."}
      </div>
    );
  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <Link
        href={`/dashboard/jobs/${jobId}`}
        className="text-muted-foreground inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft size={16} />
        {data.job.name}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-foreground text-xl font-semibold sm:text-2xl">
            Job pricing
          </h2>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            {data.policy?.name ?? "Set up a job supplier list"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.canManage && (
            <Button
              variant="outline"
              onClick={() => setAdding(true)}
              disabled={!online}
            >
              Add supplier part
            </Button>
          )}
          <Button
            variant="outline"
            onClick={exportRows}
            disabled={!data.entries.length}
          >
            <Download size={16} />
            Export
          </Button>
          {data.canManage && showMoney && (
            <>
              <Button
                variant="outline"
                disabled={!online || importing || !data.policy}
                onClick={() => file.current?.click()}
              >
                <Upload size={16} />
                {importing ? "Reading…" : "Import prices"}
              </Button>
              <input
                ref={file}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readPrices(f);
                }}
              />
            </>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        Estimated prices are budgeting allowances in CAD before tax and
        delivery. They are not confirmed supplier quotes. Each price shows its order
        unit and basis.{" "}
        {data.policy?.requireApproval
          ? "Unlisted parts require approval before ordering."
          : "Approval for unlisted parts is currently off."}
      </div>
      {message && (
        <div role="status" className="rounded-lg border p-3 text-sm">
          {message}
        </div>
      )}
      {!online && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
          Offline · connect to edit pricing or review requests.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div className="flex gap-2">
          <Button
            variant={tab === "parts" ? "default" : "ghost"}
            onClick={() => setTab("parts")}
          >
            Supplier parts · {data.entries.length}
          </Button>
          <Button
            variant={tab === "approvals" ? "default" : "ghost"}
            onClick={() => setTab("approvals")}
          >
            Approvals{" "}
            {pending.length > 0 && (
              <span className="rounded-full bg-amber-500 px-2 text-black">
                {pending.length}
              </span>
            )}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          {data.entries.filter((e) => e.priceStatus === "confirmed").length}{" "}
          confirmed ·{" "}
          {data.entries.filter((e) => e.priceStatus === "estimated").length}{" "}
          estimated ·{" "}
          {data.entries.filter((e) => e.priceStatus === "none").length} need
          prices
        </p>
      </div>
      {tab === "parts" ? (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="text-muted-foreground absolute top-3 left-3"
                size={16}
              />
              <Input
                aria-label="Search job parts"
                placeholder="Search part, supplier SKU or description"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label="Price status"
              className="bg-background max-w-full rounded-md border px-3 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All prices</option>
              <option value="estimated">Estimated</option>
              <option value="confirmed">Confirmed</option>
              <option value="none">Price needed</option>
            </select>
          </div>
          <div className="divide-y rounded-lg border">
            <div className="bg-muted/50 text-muted-foreground hidden grid-cols-[minmax(0,1fr)_9rem_11rem] gap-4 px-4 py-3 text-xs font-medium sm:grid">
              <span>Part / supplier SKU</span>
              <span>Order unit</span>
              <span className="text-right">
                {showMoney ? "CAD per order unit" : "Price status"}
              </span>
            </div>
            {rows.map((e) => (
              <button
                key={e.id}
                className="hover:bg-muted/40 grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-4 text-left transition-colors sm:grid-cols-[minmax(0,1fr)_9rem_11rem] sm:gap-4 sm:px-4"
                onClick={() => {
                  setEditing(e);
                  setEditingRevision(data.policy?.revision ?? 0);
                  setPrice(e.unitCost ?? "");
                  setStatus(e.priceStatus as typeof status);
                  setSource(e.priceSource ?? "");
                }}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {e.displayName}
                  </span>
                  <span className="text-muted-foreground mt-1 block text-xs break-words">
                    {e.supplierName} ·{" "}
                    {e.supplierSku?.trim() ? e.supplierSku : "SKU needed"}
                  </span>
                  <span className="text-muted-foreground mt-1 block text-xs sm:hidden">
                    per {e.priceBasis}
                  </span>
                </span>
                <span className="text-muted-foreground hidden text-sm sm:block">
                  {e.priceBasis}
                </span>
                <span className="text-right">
                  <span className="block text-sm font-medium">
                    {showMoney ? money(e.unitCost) : ""}
                  </span>
                  <span
                    className={`mt-1 block text-xs ${e.priceStatus === "confirmed" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}
                  >
                    {e.priceStatus === "confirmed"
                      ? "Confirmed"
                      : e.priceStatus === "estimated"
                        ? "Estimated"
                        : "Price needed"}
                  </span>
                </span>
              </button>
            ))}
            {!rows.length && (
              <p className="text-muted-foreground p-8 text-center text-sm">
                No matching supplier parts.
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {(requests.data ?? []).map((r) => (
            <article key={r.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  className="font-medium underline underline-offset-4"
                  href={`/dashboard/material-lists/${r.materialListId}`}
                >
                  {r.listName} · {r.supplierName}
                </Link>
                <span className="text-muted-foreground text-xs uppercase">
                  {r.usedAt ? "Ordered" : r.status}
                </span>
              </div>
              <p className="mt-2 text-sm">{r.requestNote}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {r.requesterName ?? "Member"} ·{" "}
                {new Date(r.createdAt).toLocaleString("en-CA")} ·{" "}
                {r.snapshot.filter((i) => !i.listed).length} unlisted parts
              </p>
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer">
                  Review order contents
                </summary>
                <ul className="mt-2 space-y-2">
                  {r.snapshot.map((i) => (
                    <li key={i.id}>
                      {i.quantity} × {i.descriptionSnapshot ?? "Part"}{" "}
                      {i.supplierSku ? `[${i.supplierSku}]` : ""}
                      {!i.listed && (
                        <span className="ml-2 text-amber-700 dark:text-amber-300">
                          Unlisted
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
              {r.reviewNote && (
                <p className="text-muted-foreground mt-3 text-sm">
                  Review: {r.reviewNote}
                </p>
              )}
              {r.status === "pending" && data.canApprove && (
                <Button
                  className="mt-3"
                  variant="outline"
                  disabled={!online}
                  onClick={() => {
                    setReview(r);
                    setNote("");
                  }}
                >
                  Review request
                </Button>
              )}
            </article>
          ))}
          {!requests.data?.length && (
            <p className="text-muted-foreground py-10 text-center text-sm">
              No approval requests. Orders containing unlisted parts can request
              approval from the order preview.
            </p>
          )}
        </div>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.displayName}</DialogTitle>
            <DialogDescription>
              {editing?.supplierName} SKU {editing?.supplierSku} · CAD per{" "}
              {editing?.priceBasis}
            </DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Supplier description:{" "}
            {editing?.sourceDescription?.trim()
              ? editing.sourceDescription
              : "Not supplied"}
          </p>
          {showMoney && (
            <label className="space-y-1 text-sm">
              <span>Price per {editing?.priceBasis} (CAD)</span>
              <Input
                aria-label="CAD price"
                type="number"
                min="0"
                step="0.0001"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={!data.canManage || !online}
              />
            </label>
          )}
          <label className="space-y-1 text-sm">
            <span>Price status</span>
            <select
              aria-label="Price confirmation"
              className="bg-background block w-full rounded-md border p-2"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              disabled={!data.canManage || !online}
            >
              <option value="estimated">Estimated</option>
              <option value="confirmed">Confirmed supplier price</option>
              <option value="none">Price needed</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>Source / assumptions</span>
            <Textarea
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={!data.canManage || !online}
              className="min-h-28"
            />
          </label>
          {data.canManage && showMoney && (
            <Button
              disabled={
                !online ||
                save.isPending ||
                !source.trim() ||
                (status !== "none" &&
                  (price.trim() === "" ||
                    !Number.isFinite(Number(price)) ||
                    Number(price) < 0))
              }
              onClick={() => {
                if (editing && data.policy)
                  save.mutate({
                    jobId,
                    revision: editingRevision,
                    lines: [
                      {
                        entryId: editing.id,
                        unitCost: status === "none" ? null : Number(price),
                        priceStatus: status,
                        priceSource: source,
                      },
                    ],
                  });
              }}
            >
              {save.isPending ? "Saving…" : "Save price"}
            </Button>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!review}
        onOpenChange={(v) => {
          if (!v) setReview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review unlisted order</DialogTitle>
            <DialogDescription>
              {review?.listName} · {review?.supplierName}. Approval covers these
              exact parts, quantities, supplier and prices. Later changes need
              another review.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Review note"
            placeholder="Reason for approval or return"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              disabled={!online || note.trim().length < 3 || decide.isPending}
              onClick={() =>
                review &&
                decide.mutate({
                  approvalId: review.id,
                  decision: "approved",
                  note,
                })
              }
            >
              <Check size={16} />
              Approve order
            </Button>
            <Button
              variant="outline"
              disabled={!online || note.trim().length < 3 || decide.isPending}
              onClick={() =>
                review &&
                decide.mutate({
                  approvalId: review.id,
                  decision: "rejected",
                  note,
                })
              }
            >
              <X size={16} />
              Return request
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!importRows}
        onOpenChange={(v) => {
          if (!v) setImportRows(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply imported prices?</DialogTitle>
            <DialogDescription>
              {importRows?.length} matching supplier SKUs. Prices use the
              existing order units. Review the exported file before importing;
              label real quotes “confirmed” and allowances “estimated”.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {importRows?.filter((r) => r.priceStatus === "confirmed").length}{" "}
            confirmed ·{" "}
            {importRows?.filter((r) => r.priceStatus === "estimated").length}{" "}
            estimated
          </p>
          <Button
            disabled={save.isPending || !online}
            onClick={() =>
              importRows &&
              save.mutate({
                jobId,
                revision: importRevision,
                lines: importRows,
              })
            }
          >
            Apply {importRows?.length} prices
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add a supplier part</DialogTitle>
            <DialogDescription>
              Choose an existing catalogue part and its supplier listing. Its
              part description and photo stay shared.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Find catalogue part"
            placeholder="Search catalogue"
            value={partSearch}
            onChange={(e) => {
              setPartSearch(e.target.value);
              setSelectedPart(null);
            }}
          />
          {!selectedPart && (
            <div className="max-h-72 overflow-y-auto">
              {found.data?.map((p) => (
                <button
                  className="hover:bg-muted/40 block w-full border-b py-3 text-left text-sm"
                  key={p.id}
                  onClick={() => setSelectedPart(p.id)}
                >
                  {p.displayName}
                </button>
              ))}
            </div>
          )}
          {selectedPart && (
            <div>
              {part.data?.map((sp) => (
                <Button
                  className="mb-2 w-full justify-start"
                  variant="outline"
                  key={sp.id}
                  disabled={add.isPending}
                  onClick={() => add.mutate({ jobId, supplierPartId: sp.id })}
                >
                  {sp.supplier?.name} ·{" "}
                  {sp.supplierSku?.trim() ? sp.supplierSku : "No SKU"}
                </Button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
