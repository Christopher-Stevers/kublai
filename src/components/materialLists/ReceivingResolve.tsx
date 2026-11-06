"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon, ChevronDownIcon, Undo2Icon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SlipLineImage } from "./SlipLineImage";
import { ResolveSlipSource } from "./ResolveSlipSource";
import { ReceivingReplaceSource } from "./ReceivingReplaceSource";
import { ReceivingItemPreview } from "./ReceivingItemPreview";
import { receivingQuantity } from "~/lib/receiving-quantity-display";
import {
  resolutionBlockers,
  resolutionEvidenceFingerprint,
  receivedLineQuantity,
  receivingLineReady,
} from "~/lib/receiving-resolution";
import { lineReadings, readSlipQuantity } from "~/lib/packing-slip-review";
import { readerLabels } from "~/lib/packing-slip-trial";
import { convertedOrderedQuantity } from "~/lib/receiving-review";
import type { SlipBox } from "~/lib/packing-slip-review";
import type { ReceivingLine } from "~/lib/receiving-review";
import type { ReceivingDetail, ReceivingAction } from "./ReceivingWorkspace";

export type ResolveTarget = { lineId?: string; itemId?: string };
const field =
  "border-input bg-background min-h-11 w-full rounded-md border px-3 text-base";
const label = "grid gap-1.5 text-sm";
const qty = (n: number | null | undefined, unit: string) =>
  n == null ? "Not read" : receivingQuantity(n, unit);
export function ReceivingResolve({
  detail,
  jobId,
  target,
  busy,
  run,
  onClose,
  onSelect,
  onReload,
  onAddLine,
  renderCorrection,
}: {
  detail: ReceivingDetail;
  jobId: string;
  target: ResolveTarget;
  busy: boolean;
  run: (action: ReceivingAction) => Promise<boolean>;
  onClose: () => void;
  onSelect: (target: ResolveTarget) => void;
  onReload: () => Promise<void>;
  onAddLine: (value: {
    page: number;
    description: string;
    box?: SlipBox;
  }) => Promise<boolean>;
  renderCorrection: (line: ReceivingLine, onDone: () => void) => ReactNode;
}) {
  const line = detail.review.lines.find((l) => l.id === target.lineId);
  const item = detail.items.find(
    (i) => i.id === (line?.orderItemId ?? target.itemId),
  );
  const [page, setPage] = useState<
    | "review"
    | "source"
    | "find"
    | "choose"
    | "edit"
    | "delivery"
    | "allocate"
    | "part"
    | "replace"
    | "exclude"
  >("review");
  const [search, setSearch] = useState("");
  const sourceChanged =
    detail.review.versionId !== detail.document.currentVersionId;
  const orderResolution = item
    ? detail.review.orderResolutions?.[item.id]
    : undefined;
  const [note, setNote] = useState(
    line?.resolution?.note ?? orderResolution?.note ?? "",
  );
  const [disposition, setDisposition] = useState(
    orderResolution?.disposition ?? "unresolved",
  );
  const [delivery, setDelivery] = useState(
    line?.resolution?.delivery ?? "short",
  );
  const [site, setSite] = useState(
    line?.resolution?.siteQuantity == null
      ? ""
      : String(line.resolution.siteQuantity),
  );
  const [accepted, setAccepted] = useState(
    line?.resolution?.acceptedQuantity == null
      ? ""
      : String(line.resolution.acceptedQuantity),
  );
  const [remainder, setRemainder] = useState(line?.resolution?.remainder ?? "");
  const [excess, setExcess] = useState(line?.resolution?.excess ?? "");
  const [candidate, setCandidate] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [pendingLineId, setPendingLineId] = useState<string | null>(null);
  const correctionLine = pendingLineId
    ? detail.review.lines.find((l) => l.id === pendingLineId)
    : line;
  const [localMessage, setLocalMessage] = useState("");
  const [sources, setSources] = useState<string[]>(line ? [line.id] : []);
  const [outputs, setOutputs] = useState([
    {
      description: line?.description ?? item?.description ?? "",
      sku: line?.sku ?? "",
      quantity: line?.quantity == null ? "" : String(line.quantity),
      unit: line?.unit ?? item?.unit ?? "ea",
      orderItemId: line?.orderItemId ?? item?.id ?? "",
    },
  ]);
  const source =
    line?.sourceIndex !== undefined &&
    detail.review.analysisRunId ===
      detail.document.packingSlipAnalysis?.runId &&
    detail.review.versionId === detail.document.packingSlipAnalysis?.versionId
      ? detail.document.packingSlipAnalysis?.lines[line.sourceIndex]
      : undefined;
  const creditOnly = (line?.kind ?? detail.review.kind) === "credit-only";
  const blockers = line
    ? resolutionBlockers(line, item, detail.review.lines, detail.review.kind)
    : [];
  const activeReader =
    line?.predictionSource?.reader ?? line?.readingSource?.reader;
  const confidence = line?.predictionSource?.confidence;
  const original = line?.paper ?? {
    quantity: source?.shipped ?? line?.quantity,
    ordered: source?.ordered ?? line?.ordered,
    unit: source?.unit ?? line?.unit ?? "",
    description: source?.description ?? line?.description,
    sku: source?.sku ?? line?.sku,
  };
  const resolve = async (decision: ReceivingAction) => {
    if (!line || sourceChanged) return false;
    return run({
      ...decision,
      action: "resolve",
      lineId: line.id,
      evidenceFingerprint: resolutionEvidenceFingerprint(line),
      note,
      skipped: decision.skipped ?? false,
    });
  };
  const next = () => {
    const current = line ? detail.review.lines.indexOf(line) : -1;
    const following = detail.review.lines.slice(current + 1).find(
      (l) =>
        !l.ignored &&
        !l.approved &&
        (!l.checked ||
          resolutionBlockers(
            l,
            detail.items.find((i) => i.id === l.orderItemId),
            detail.review.lines,
            detail.review.kind,
          ).length),
    );
    if (following) onSelect({ lineId: following.id });
    else onClose();
  };
  const updateLink = async (l: ReceivingLine, orderItemId: string | null) => {
    const chosen = detail.items.find((i) => i.id === orderItemId);
    const converted =
      chosen && l.quantity != null
        ? readSlipQuantity(l.quantity, l.unit, chosen)
        : null;
    if (chosen && l.quantity != null && !converted) {
      setPendingLink(chosen.id);
      setPendingLineId(l.id);
      setLocalMessage(
        "The counterpart uses a different or ambiguous unit. Enter and confirm the conversion before saving.",
      );
      setPage("edit");
      return;
    }
    if (
      await run({
        action: "line",
        lineId: l.id,
        kind: l.kind ?? null,
        description: l.description,
        sku: l.sku,
        quantity: converted?.amount ?? l.quantity,
        ordered: converted
          ? convertedOrderedQuantity(l.ordered, l.quantity, converted.amount)
          : l.ordered,
        unit: chosen?.unit ?? l.unit,
        unitPrice: l.unitPrice,
        orderItemId,
        checked: false,
      })
    ) {
      setCandidate(null);
      setPage("review");
      onSelect({ lineId: l.id });
    }
  };
  const confirmMatch = async () => {
    await resolve({ action: "resolve", match: "confirmed" });
  };
  const contributors = item
    ? detail.review.lines.filter((l) => !l.ignored && l.orderItemId === item.id)
    : [];
  const pending = detail.review.lines.filter((l) => !l.ignored && !l.approved);
  const linkedElsewhere =
    candidate && !line
      ? detail.review.lines.find((l) => l.id === candidate)
      : undefined;
  const otherOwner = linkedElsewhere?.orderItemId
    ? detail.items.find((i) => i.id === linkedElsewhere.orderItemId)
    : undefined;
  const itemSnapshot = (
    detail.document.packingSlipAnalysis?.confirmedItems ??
    detail.document.packingSlipAnalysis?.items
  )?.find((i) => i.id === item?.id);
  const differentOrder =
    !!item &&
    !!itemSnapshot &&
    ((itemSnapshot.originalOrdered ??
      itemSnapshot.ordered + (itemSnapshot.credited ?? 0)) !==
      (item.originalOrdered ?? item.ordered + (item.credited ?? 0)) ||
      itemSnapshot.description !== item.description ||
      itemSnapshot.sku !== item.sku ||
      itemSnapshot.unit !== item.unit ||
      itemSnapshot.piecesPerPack !== item.piecesPerPack ||
      itemSnapshot.individualUnit !== item.individualUnit);
  const noLineCandidates = !line
    ? pending.filter((l) =>
        `${l.description} ${l.sku}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
    : [];
  const ready =
    !!line &&
    receivingLineReady(line, detail.review.kind, item, detail.review.lines);
  const primary = !line
    ? { label: "Choose slip line", run: () => setPage("choose") }
    : !line.orderItemId
      ? { label: "Find order item", run: () => setPage("choose") }
      : ready || line.approved
        ? { label: "Next line", run: next }
        : line.resolution?.match !== "confirmed"
          ? { label: "Confirm part match", run: () => void confirmMatch() }
          : line.resolution.specification === "unresolved"
            ? {
                label: "Check specification",
                run: () =>
                  void resolve({
                    action: "resolve",
                    specification: "confirmed",
                  }),
              }
            : line.resolution.quantity === "unresolved"
              ? { label: "Check quantity & unit", run: () => setPage("edit") }
              : creditOnly
                ? {
                    label: "Confirm credit",
                    run: () =>
                      void resolve({
                        action: "resolve",
                        delivery: "confirmed",
                      }),
                  }
                : { label: "Review delivery", run: () => setPage("delivery") };
  return (
    <section
      aria-label="Resolve packing-slip line"
      className="mx-auto max-w-5xl space-y-4 pb-28"
    >
      <header className="flex items-center justify-between gap-3 border-b pb-3">
        <Button
          variant="ghost"
          onClick={page === "review" ? onClose : () => setPage("review")}
        >
          <ArrowLeftIcon />
          {page === "review" ? "Back to lines" : "Back"}
        </Button>
        <div className="min-w-0 text-right">
          <h1 className="font-semibold">Resolve</h1>
          <p className="text-muted-foreground truncate text-sm">
            {detail.document.packingSlip?.orderNumber ?? detail.document.name}
          </p>
        </div>
      </header>
      {sourceChanged && (
        <p role="alert" className="rounded border border-amber-500 p-3 text-sm">
          The source file changed. Return to the line list and review the new
          version before using this evidence.
        </p>
      )}
      {localMessage && (
        <p role="status" className="rounded border p-3 text-sm">
          {localMessage}
        </p>
      )}
      <fieldset
        hidden={sourceChanged}
        disabled={busy}
        className="min-w-0 space-y-4"
      >
        {page === "review" && (
          <>
            <div className="grid grid-cols-2 gap-4 divide-x">
              <button
                type="button"
                onClick={() => item && setPage("part")}
                disabled={!item}
                className="min-w-0 space-y-2 pr-2 text-left"
              >
                <span className="text-muted-foreground text-xs uppercase">
                  Order
                </span>
                <h2 className="font-semibold break-words">
                  {item?.description ?? "No matching order item"}
                </h2>
                {item && (
                  <>
                    <p className="text-sm">
                      Ordered <strong>{qty(item.ordered, item.unit)}</strong>
                    </p>
                    <p className="text-sm">
                      Previously received{" "}
                      <strong>{qty(item.received, item.unit)}</strong>
                    </p>
                    <p className="text-sm">
                      Still due{" "}
                      <strong>
                        {qty(
                          Math.max(0, item.ordered - item.received),
                          item.unit,
                        )}
                      </strong>
                    </p>
                    {item.sku && (
                      <p className="text-muted-foreground text-xs break-all">
                        {item.sku}
                      </p>
                    )}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setPage("source")}
                className="min-w-0 space-y-2 pl-2 text-left"
              >
                <span className="text-muted-foreground text-xs uppercase">
                  {activeReader
                    ? `${readerLabels[activeReader]} · active saved reading`
                    : "Slip"}
                </span>
                <h2 className="font-semibold break-words">
                  {line?.description ?? "No slip line linked"}
                </h2>
                {line && (
                  <>
                    <p className="text-sm">
                      Paper quantity{" "}
                      <strong>{qty(original.quantity, original.unit)}</strong>
                    </p>
                    <p className="text-sm">
                      Reviewed quantity{" "}
                      <strong>{qty(line.quantity, line.unit)}</strong>
                    </p>
                    {line.resolution?.siteQuantity != null && (
                      <p className="text-sm">
                        Counted on site{" "}
                        <strong>
                          {qty(line.resolution.siteQuantity, line.unit)}
                        </strong>
                      </p>
                    )}
                    <p className="text-sm">
                      {creditOnly ? "To credit" : "To receive"}{" "}
                      <strong>
                        {qty(receivedLineQuantity(line), line.unit)}
                      </strong>
                    </p>
                  </>
                )}
              </button>
            </div>
            {contributors.length > 1 && (
              <div className="space-y-2 rounded border p-3">
                <p className="text-sm font-medium">
                  {contributors.length} slip lines linked to this order item
                </p>
                <div className="flex flex-wrap gap-2">
                  {contributors.map((l) => (
                    <Button
                      key={l.id}
                      size="sm"
                      variant={line?.id === l.id ? "default" : "outline"}
                      onClick={() => onSelect({ lineId: l.id })}
                    >
                      Page {l.page} · {qty(receivedLineQuantity(l), l.unit)}
                      {l.approved ? " · received" : ""}
                    </Button>
                  ))}
                </div>
                {contributors.every((l) => l.unit === item?.unit) && (
                  <p className="text-muted-foreground text-sm">
                    Total on this slip:{" "}
                    {qty(
                      contributors.reduce(
                        (sum, l) => sum + (receivedLineQuantity(l) ?? 0),
                        0,
                      ),
                      item!.unit,
                    )}
                  </p>
                )}
              </div>
            )}
            {confidence && (
              <p className="text-muted-foreground text-sm">
                Saved match confidence:{" "}
                {Math.round(confidence.match.value * 100)}% · quantity
                confidence: {Math.round(confidence.quantity.value * 100)}%. Each
                must reach 90% for automatic confirmation; other unresolved
                issues still apply.
              </p>
            )}
            {line?.humanEdited && (
              <p className="text-muted-foreground text-sm">
                This line has been edited. The reader scores describe the
                original reading.
              </p>
            )}
            {!line && (
              <p className="rounded-lg border p-3 text-sm">
                No slip line has been linked to this order item. It may be
                elsewhere on the slip, missed by the scan, or still outstanding.
              </p>
            )}
            {line?.resolution?.skipped && (
              <p className="text-sm text-amber-600">
                Skipped for now · still unresolved
              </p>
            )}
            {line && (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="font-medium">
                  {ready
                    ? "Ready for Review & Approve"
                    : line.approved
                      ? "Already received — corrections must preserve receipt history"
                      : "Check each issue"}
                </p>
                {blockers.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                {!line.resolution && !line.checked && !line.autoConfirmed && (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {line.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                )}
                {!line.approved && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="outline"
                      disabled={!line.orderItemId}
                      onClick={() => void confirmMatch()}
                    >
                      {line.resolution?.match === "confirmed"
                        ? "Match confirmed"
                        : "Confirm part match"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void resolve({
                          action: "resolve",
                          specification: "confirmed",
                        })
                      }
                    >
                      {line.resolution?.specification === "confirmed"
                        ? "Specifications confirmed"
                        : "Confirm size & specification"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void resolve({
                          action: "resolve",
                          quantity: "confirmed",
                        })
                      }
                    >
                      {line.resolution?.quantity === "confirmed"
                        ? "Quantity confirmed"
                        : "Confirm quantity & unit"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void resolve({
                          action: "resolve",
                          delivery: "confirmed",
                        })
                      }
                    >
                      {line.resolution?.delivery === "confirmed"
                        ? "Delivery confirmed"
                        : creditOnly
                          ? "Credit matches paperwork"
                          : "Delivery matches paperwork"}
                    </Button>
                  </div>
                )}
              </div>
            )}
            {differentOrder && (
              <div className="rounded border p-3 text-sm">
                <p className="font-medium">
                  Order changed since this slip was read
                </p>
                <p>
                  Receipt-time snapshot: {itemSnapshot.description} ·{" "}
                  {qty(itemSnapshot.ordered, itemSnapshot.unit)} ·{" "}
                  {itemSnapshot.sku}
                </p>
                <p>
                  Current order: {item.description} ·{" "}
                  {qty(item.ordered, item.unit)} · {item.sku}
                </p>
              </div>
            )}
            {line && (
              <details className="rounded border p-3">
                <summary className="cursor-pointer text-sm">
                  Evidence and other saved readings
                </summary>
                <p className="my-3 text-sm">
                  Page {line.page} · {line.evidence}
                </p>
                {source &&
                  lineReadings(source).map((reading, i) => (
                    <div key={i} className="space-y-2 border-t py-3 text-sm">
                      <p>
                        {readerLabels[reading.reader]} · match{" "}
                        {reading.match == null
                          ? "unknown"
                          : `${Math.round(reading.match * 100)}%`}{" "}
                        · quantity{" "}
                        {reading.quantity == null
                          ? "unknown"
                          : `${Math.round(reading.quantity * 100)}%`}
                      </p>
                      <p>{qty(reading.shipped, reading.unit ?? line.unit)}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          !!line.approved || reading.shipped == null || !item
                        }
                        onClick={async () => {
                          if (!item || reading.shipped == null) return;
                          const converted = readSlipQuantity(
                            Math.abs(reading.shipped),
                            reading.unit,
                            item,
                          );
                          if (!converted) {
                            setLocalMessage(
                              "That saved reading uses an ambiguous unit. Correct and confirm the conversion before saving.",
                            );
                            setPage("edit");
                            return;
                          }
                          await run({
                            action: "line",
                            lineId: line.id,
                            kind: line.kind ?? null,
                            description: line.description,
                            sku: line.sku,
                            quantity: converted.amount,
                            // The reviewed ordered count is already in the order unit.
                            ordered: line.ordered,
                            unit: item.unit,
                            unitPrice: line.unitPrice,
                            orderItemId: line.orderItemId,
                            checked: false,
                          });
                        }}
                      >
                        Use this quantity for review
                      </Button>
                    </div>
                  ))}
                <p className="text-muted-foreground text-xs">
                  Changing the reading does not approve it.
                </p>
              </details>
            )}
            <label className={label}>
              Resolution note
              <textarea
                className={`${field} py-2`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What needs checking, or why this decision is correct"
              />
            </label>
            {!line && item && (
              <div className="space-y-3 rounded border p-3">
                <label className={label}>
                  Order item status
                  <select
                    className={field}
                    value={disposition}
                    onChange={(e) =>
                      setDisposition(e.target.value as typeof disposition)
                    }
                  >
                    <option value="unresolved">Still investigating</option>
                    <option value="outstanding">Outstanding — still due</option>
                    <option value="backordered">Backordered — still due</option>
                    <option value="cancel-requested">
                      Cancellation requested
                    </option>
                  </select>
                </label>
                <p className="text-muted-foreground text-sm">
                  This records the reason. It does not receive stock or cancel
                  the order item.
                </p>
                <Button
                  variant="outline"
                  disabled={
                    disposition === "cancel-requested" && note.trim().length < 3
                  }
                  onClick={async () => {
                    if (
                      await run({
                        action: "orderDisposition",
                        itemId: item.id,
                        disposition,
                        note,
                      })
                    )
                      onClose();
                  }}
                >
                  Save order item status
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCandidate(null);
                  setPage("choose");
                }}
              >
                {line ? "Find order item" : "Choose slip line"}
              </Button>
              <Button variant="outline" onClick={() => setPage("find")}>
                Find on slip / add missed line
              </Button>
              {line && (
                <>
                  <Button variant="outline" onClick={() => setPage("edit")}>
                    Correct reading
                  </Button>
                  {!creditOnly && (
                    <Button
                      variant="outline"
                      onClick={() => setPage("delivery")}
                    >
                      Record delivery issue
                    </Button>
                  )}
                </>
              )}
            </div>
            <details>
              <summary className="inline-flex cursor-pointer items-center gap-1 py-2 text-sm">
                More
                <ChevronDownIcon className="size-4" />
              </summary>
              <div className="flex flex-wrap gap-2 py-2">
                {line && !line.approved && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setPage("allocate")}
                    >
                      Merge / split / allocate
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void updateLink(line, null)}
                    >
                      Unlink order item
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setPage("exclude")}
                    >
                      Exclude non-material / duplicate
                    </Button>
                  </>
                )}
                <Button variant="outline" onClick={() => setPage("replace")}>
                  Replace incomplete source
                </Button>
                <Button variant="outline" onClick={onClose}>
                  Order and duplicate checks
                </Button>
              </div>
            </details>
          </>
        )}
        {page === "part" && item && (
          <ReceivingItemPreview
            item={item}
            part={detail.orderParts?.[item.id]}
            materialListId={detail.document.packingSlip?.materialListId ?? ""}
            materialListName={detail.document.packingSlip?.materialListName}
            supplierName={detail.review.supplierName}
          />
        )}
        {page === "source" && (
          <>
            <h2 className="font-semibold">Original slip</h2>
            <SlipLineImage
              url={detail.sourceUrl}
              page={line?.page ?? 1}
              box={
                line?.sourceBox ??
                source?.box ?? { x: 0, y: 0, width: 1, height: 1 }
              }
              label="Original slip evidence"
              initiallyZoomed
              showError
            />
            <Button onClick={() => setPage("find")}>
              Find another line on the source
            </Button>
            <Button variant="outline" asChild>
              <Link
                href={`/jobs/${jobId}/documents?document=${detail.document.id}&from=receiving`}
              >
                Open full document
              </Link>
            </Button>
          </>
        )}
        {page === "find" && (
          <ResolveSlipSource
            url={detail.sourceUrl}
            initialPage={line?.page ?? 1}
            onCancel={() => setPage("review")}
            disabled={busy}
            onUse={async (value) => {
              await onAddLine(value);
            }}
          />
        )}
        {page === "replace" && (
          <ReceivingReplaceSource
            jobId={jobId}
            documentId={detail.document.id}
            expectedVersionId={detail.document.currentVersionId!}
            disabled={busy}
            onCancel={() => setPage("review")}
            onDone={async () => {
              await onReload();
              onClose();
            }}
          />
        )}
        {page === "edit" &&
          correctionLine &&
          renderCorrection(
            pendingLink
              ? { ...correctionLine, orderItemId: pendingLink }
              : correctionLine,
            () => {
              setPage("review");
              setPendingLink(null);
              setPendingLineId(null);
              setLocalMessage("");
              if (!line) onSelect({ lineId: correctionLine.id });
            },
          )}
        {page === "choose" && (
          <div className="space-y-3">
            <h2 className="font-semibold">
              {line
                ? "Choose the order counterpart"
                : "Choose a slip counterpart"}
            </h2>
            <Input
              aria-label="Search counterparts"
              placeholder="Search description or supplier code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {(line
              ? detail.items.filter((i) =>
                  `${i.description} ${i.sku}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
              : noLineCandidates
            ).map((candidateRow) => {
              const otherLines = line
                ? detail.review.lines.filter(
                    (l) =>
                      !l.ignored &&
                      l.orderItemId === candidateRow.id &&
                      l.id !== line.id,
                  )
                : [];
              const owner = !line
                ? detail.items.find(
                    (i) => i.id === (candidateRow as ReceivingLine).orderItemId,
                  )
                : undefined;
              return (
                <button
                  key={candidateRow.id}
                  type="button"
                  className={`w-full rounded border p-3 text-left text-sm ${candidate === candidateRow.id ? "border-primary bg-primary/10" : ""}`}
                  onClick={() => setCandidate(candidateRow.id)}
                >
                  <strong>{candidateRow.description}</strong>
                  <p>{candidateRow.sku}</p>
                  {owner && (
                    <p>
                      Already linked to {owner.description}. Moving returns that
                      pairing to review.
                    </p>
                  )}
                  {otherLines.length > 0 && (
                    <p>
                      {otherLines.length} slip lines already linked here. Their
                      quantities will be totalled with this line.
                    </p>
                  )}
                </button>
              );
            })}
            {candidate && (
              <div className="rounded border p-3">
                <p className="mb-3 text-sm">
                  {otherOwner
                    ? `Move this line from ${otherOwner.description}?`
                    : "Link these lines without approving quantities?"}
                </p>
                <Button
                  onClick={() => {
                    if (line) void updateLink(line, candidate);
                    else {
                      const l = detail.review.lines.find(
                        (l) => l.id === candidate,
                      );
                      if (l && item) void updateLink(l, item.id);
                    }
                  }}
                >
                  {otherOwner ? "Move line" : "Link lines"}
                </Button>
              </div>
            )}
            <Button variant="outline" onClick={() => setPage("find")}>
              Counterpart missing — find on original
            </Button>
          </div>
        )}
        {page === "delivery" && line && (
          <div className="space-y-3">
            <h2 className="font-semibold">Delivery and remaining quantity</h2>
            <p className="text-sm">
              The slip says {qty(original.quantity, original.unit)}. Record the
              site count separately.
            </p>
            <label className={label}>
              Delivery
              <select
                className={field}
                value={delivery}
                onChange={(e) => setDelivery(e.target.value as typeof delivery)}
              >
                <option value="confirmed">Matches paperwork</option>
                <option value="short">Short delivery</option>
                <option value="damaged">Damaged</option>
                <option value="wrong">Wrong part / substitution</option>
                <option value="extra">Extra delivered</option>
                <option value="unresolved">Still investigating</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                Counted on site ({line.unit})
                <input
                  className={field}
                  type="number"
                  min="0"
                  step="any"
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                />
              </label>
              <label className={label}>
                Accepted to receive ({line.unit})
                <input
                  className={field}
                  type="number"
                  min="0"
                  step="any"
                  value={accepted}
                  onChange={(e) => setAccepted(e.target.value)}
                  placeholder="Use site count"
                />
              </label>
            </div>
            <label className={label}>
              Outstanding remainder
              <select
                className={field}
                value={remainder}
                onChange={(e) => setRemainder(e.target.value)}
              >
                <option value="">No decision</option>
                <option value="backordered">Backordered / still due</option>
                <option value="cancelled">Cancellation requested</option>
                <option value="unexplained">
                  Unexplained — keep unresolved
                </option>
              </select>
            </label>
            <label className={label}>
              Excess quantity
              <select
                className={field}
                value={excess}
                onChange={(e) => setExcess(e.target.value)}
              >
                <option value="">No excess decision</option>
                <option value="accepted">Accept the excess</option>
                <option value="return">Return the excess</option>
              </select>
            </label>
            <label className={label}>
              Explanation
              <textarea
                className={`${field} py-2`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {delivery === "wrong" && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!detail.canAcceptSubstitution}
                  onClick={() =>
                    void resolve({
                      action: "resolve",
                      specification: "substitution-accepted",
                    })
                  }
                >
                  Accept substitute
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    void resolve({
                      action: "resolve",
                      specification: "substitution-rejected",
                    })
                  }
                >
                  Reject substitute
                </Button>
              </div>
            )}
            <Button
              onClick={async () => {
                if (
                  await resolve({
                    action: "resolve",
                    delivery,
                    siteQuantity: site === "" ? null : Number(site),
                    acceptedQuantity: accepted === "" ? null : Number(accepted),
                    remainder: remainder || null,
                    excess: excess || null,
                  })
                )
                  setPage("review");
              }}
            >
              Save delivery decision
            </Button>
          </div>
        )}
        {page === "allocate" && line && (
          <div className="space-y-3">
            <h2 className="font-semibold">Merge, split or allocate lines</h2>
            <p className="text-sm">
              Select the source lines and distribute their total among the
              outputs. These allocations stay on this order. Units must match;
              already received lines cannot be moved.
            </p>
            {pending.map((l) => (
              <label
                key={l.id}
                className="flex min-h-11 items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={sources.includes(l.id)}
                  onChange={(e) =>
                    setSources(
                      e.target.checked
                        ? [...sources, l.id]
                        : sources.filter((id) => id !== l.id),
                    )
                  }
                />
                {l.description} · {qty(l.quantity, l.unit)}
              </label>
            ))}
            {outputs.map((output, i) => (
              <div key={i} className="space-y-2 rounded border p-3">
                <Input
                  aria-label={`Output ${i + 1} description`}
                  value={output.description}
                  onChange={(e) =>
                    setOutputs((v) =>
                      v.map((o, n) =>
                        n === i ? { ...o, description: e.target.value } : o,
                      ),
                    )
                  }
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label={`Output ${i + 1} quantity`}
                    type="number"
                    min="0"
                    step="any"
                    value={output.quantity}
                    onChange={(e) =>
                      setOutputs((v) =>
                        v.map((o, n) =>
                          n === i ? { ...o, quantity: e.target.value } : o,
                        ),
                      )
                    }
                  />
                  <select
                    aria-label={`Output ${i + 1} order item`}
                    className={field}
                    value={output.orderItemId}
                    onChange={(e) =>
                      setOutputs((v) =>
                        v.map((o, n) =>
                          n === i ? { ...o, orderItemId: e.target.value } : o,
                        ),
                      )
                    }
                  >
                    <option value="">Unmatched</option>
                    {detail.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.description}
                      </option>
                    ))}
                  </select>
                </div>
                {outputs.length > 1 && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setOutputs((v) => v.filter((_, n) => n !== i))
                    }
                  >
                    Remove output
                  </Button>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              disabled={outputs.length >= 20}
              onClick={() =>
                setOutputs((v) => [
                  ...v,
                  { ...v[0]!, quantity: "", orderItemId: "" },
                ])
              }
            >
              Add output
            </Button>
            <label className={label}>
              Reason
              <textarea
                className={`${field} py-2`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <Button
              disabled={
                !sources.length ||
                note.trim().length < 3 ||
                outputs.some((o) => !o.quantity || !o.description.trim())
              }
              onClick={async () => {
                if (
                  await run({
                    action: "allocate",
                    lineIds: sources,
                    reason: note,
                    outputs: outputs.map((o) => ({
                      ...o,
                      quantity: Number(o.quantity),
                      orderItemId: o.orderItemId || null,
                    })),
                  })
                )
                  onClose();
              }}
            >
              Save allocation for review
            </Button>
          </div>
        )}
        {page === "exclude" && line && (
          <div className="space-y-3">
            <h2 className="font-semibold">Exclude an extracted line</h2>
            <p className="text-sm">
              Use for headings, freight, totals or a confirmed duplicate
              extraction. A shortage or an unanswered question should stay
              unresolved.
            </p>
            <label className={label}>
              Reason
              <textarea
                className={`${field} py-2`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <Button
              disabled={note.trim().length < 3 || !!line.approved}
              onClick={async () => {
                if (
                  await run({ action: "ignore", lineId: line.id, reason: note })
                )
                  onClose();
              }}
            >
              Exclude with reason
            </Button>
          </div>
        )}
      </fieldset>
      <footer className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          <Button
            variant="outline"
            disabled={busy || sourceChanged || !detail.correctionUndo}
            onClick={async () => {
              if (
                detail.correctionUndo &&
                (await run({
                  action: "undoCorrection",
                  requestIdToUndo: detail.correctionUndo.requestId,
                  reason: "Reviewer undid the last correction",
                }))
              ) {
                setPage("review");
                onClose();
              }
            }}
          >
            <Undo2Icon className="size-4" />
            Undo
          </Button>
          <Button
            variant="outline"
            disabled={busy || sourceChanged || !!line?.approved}
            onClick={async () => {
              if (!line) {
                if (
                  item &&
                  (await run({
                    action: "orderDisposition",
                    itemId: item.id,
                    disposition: "unresolved",
                    note,
                  }))
                )
                  onClose();
                return;
              }
              if (await resolve({ action: "resolve", skipped: true })) next();
            }}
          >
            Skip
          </Button>
          <Button
            className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal sm:flex-none"
            disabled={busy || sourceChanged}
            onClick={page === "review" ? primary.run : () => setPage("review")}
          >
            {page === "review" ? primary.label : "Back to resolution"}
          </Button>
        </div>
      </footer>
    </section>
  );
}
