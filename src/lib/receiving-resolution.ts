import type {
  ReceivingLine,
  ReceivingReview,
  ReceiptKind,
} from "./receiving-review";
import { receiptUnit, type ReceiptOrderItem } from "./packing-slip-review";

/** Independent reviewer decisions. Linking a part never confirms its quantity or delivery. */
export const materialIssueLabels = {
  "shipped-mismatch": "Shipped Material Doesn’t Match Slip",
  "supplier-keep": "Supplier Entered This Incorrectly · Keep material anyway",
  "supplier-return": "Supplier Entered This Incorrectly · Material needs to be returned",
} as const;
export type ReceivingResolution = {
  materialIssue?: keyof typeof materialIssueLabels;
  evidenceFingerprint: string;
  counterpartFingerprint?: string;
  match: "confirmed" | "unresolved";
  specification:
    | "confirmed"
    | "substitution-accepted"
    | "substitution-rejected"
    | "unresolved";
  quantity: "confirmed" | "unresolved";
  delivery:
    | "confirmed"
    | "short"
    | "damaged"
    | "wrong"
    | "extra"
    | "unresolved";
  siteQuantity?: number | null;
  acceptedQuantity?: number | null;
  remainder?: "backordered" | "cancelled" | "unexplained" | null;
  excess?: "accepted" | "return" | null;
  skipped?: boolean;
  note: string;
  by: string;
  at: string;
};

/** Comparable in the browser and server; includes the source identity and every edited receipt field. */
export function resolutionEvidenceFingerprint(line: ReceivingLine) {
  return JSON.stringify([
    line.orderItemId,
    line.description,
    line.sku,
    line.quantity,
    line.ordered,
    receiptUnit(line.unit),
    line.kind ?? null,
    line.page,
    line.sourceIndex ?? null,
    line.sourceBox ?? null,
    line.evidence,
  ]);
}

/** The identity and conversion facts of the counterpart; receipt progress is not identity. */
export function resolutionCounterpartFingerprint(item: ReceiptOrderItem) {
  return JSON.stringify([
    item.id,
    item.description,
    item.sku,
    receiptUnit(item.unit),
    item.piecesPerPack,
    item.individualUnit,
    item.originalOrdered ?? item.ordered + (item.credited ?? 0),
  ]);
}

export function receivedLineQuantity(line: ReceivingLine) {
  return (
    line.resolution?.acceptedQuantity ??
    line.resolution?.siteQuantity ??
    line.quantity
  );
}

export function pendingOrderResolutions(review: ReceivingReview) {
  return Object.values(review.orderResolutions ?? {}).filter(
    (r) =>
      r.disposition === "unresolved" || r.disposition === "cancel-requested",
  ).length;
}

/** A source stays retired while any descendant still owns its allocated quantity. */
export function hasActiveAllocationDescendant(
  lines: ReceivingLine[],
  sourceId: string,
) {
  const visited = new Set([sourceId]);
  const pending = [sourceId];
  while (pending.length) {
    const parent = pending.pop()!;
    for (const child of lines) {
      if (
        visited.has(child.id) ||
        !child.allocation?.sourceLineIds.includes(parent)
      )
        continue;
      visited.add(child.id);
      if (!child.ignored || (child.approved?.quantity ?? 0) > 0) return true;
      pending.push(child.id);
    }
  }
  return false;
}

/** Old children cannot revive after their source was restored or reallocated. */
export function allocationOwnershipValid(
  lines: ReceivingLine[],
  line: ReceivingLine,
  path = new Set<string>(),
): boolean {
  if (path.has(line.id)) return false;
  if (!line.allocation) return true;
  const next = new Set(path).add(line.id);
  return line.allocation.sourceLineIds.every((id) => {
    const source = lines.find((l) => l.id === id);
    return (
      !!source?.ignored &&
      source.allocatedTo === line.allocation!.operationId &&
      allocationOwnershipValid(lines, source, next)
    );
  });
}

/** Shared draft/correction readiness; source confidence is recomputed by the server. */
export function receivingLineReady(
  line: ReceivingLine,
  kind: ReceiptKind,
  item?: ReceiptOrderItem,
  lines: ReceivingLine[] = [line],
) {
  const quantity = receivedLineQuantity(line);
  const changed =
    line.approved?.quantity !== quantity ||
    line.approved.kind !== (line.kind ?? kind);
  return (
    !line.ignored &&
    !!line.orderItemId &&
    quantity !== null &&
    Number.isFinite(quantity) &&
    quantity >= 0 &&
    (quantity > 0 ||
      !!line.approved ||
      (!!line.resolution &&
        !["confirmed", "unresolved"].includes(line.resolution.delivery))) &&
    changed &&
    (line.checked === true ||
      line.autoConfirmed === true ||
      line.issues.length === 0) &&
    resolutionBlockers(line, item, lines, kind).length === 0
  );
}

export function newResolution(
  line: ReceivingLine,
  by: string,
  at: string,
): ReceivingResolution {
  return {
    evidenceFingerprint: resolutionEvidenceFingerprint(line),
    match: "unresolved",
    specification: "unresolved",
    quantity: "unresolved",
    delivery: "unresolved",
    note: "",
    by,
    at,
  };
}

/** What each of the four checks still asks, worded as its blocker. */
export const OPEN_CHECKS = {
  match: "Choose and confirm the matching order item.",
  specification: "Confirm the size, material, connection and specification.",
  quantity: "Confirm the printed quantity and any unit conversion.",
  delivery: "Confirm what arrived, or record the delivery issue.",
} as const;

/** Returns only structured Resolve blockers. Existing confidence/source checks remain separate. */
export function resolutionBlockers(
  line: ReceivingLine,
  item?: ReceiptOrderItem,
  lines: ReceivingLine[] = [line],
  fallbackKind: ReceiptKind = "delivery",
): string[] {
  const r = line.resolution;
  if (!r) return [];
  const problems: string[] = [];
  if (r.skipped)
    problems.push("Skipped for now; this line is still unresolved.");
  if (r.evidenceFingerprint !== resolutionEvidenceFingerprint(line))
    problems.push(
      "The line changed. Recheck each resolution against the current evidence.",
    );
  if (
    item &&
    r.counterpartFingerprint !== resolutionCounterpartFingerprint(item)
  )
    problems.push(
      "The order item or package changed. Reconfirm the match, specification and quantity conversion.",
    );
  if (!line.orderItemId || r.match !== "confirmed")
    problems.push(OPEN_CHECKS.match);
  if (r.specification === "unresolved")
    problems.push(OPEN_CHECKS.specification);
  if (
    r.specification === "substitution-rejected" &&
    receivedLineQuantity(line) !== 0
  )
    problems.push(
      "A rejected substitute cannot be received. Record zero accepted or select the correct part.",
    );
  if (r.quantity !== "confirmed")
    problems.push(OPEN_CHECKS.quantity);
  if (r.delivery === "unresolved")
    problems.push(OPEN_CHECKS.delivery);
  const site = r.siteQuantity,
    accepted = receivedLineQuantity(line);
  if (
    site !== undefined &&
    site !== null &&
    (!Number.isFinite(site) || site < 0)
  )
    problems.push("Enter a valid actual site count.");
  if (accepted === null || !Number.isFinite(accepted) || accepted < 0)
    problems.push("Enter a valid accepted quantity.");
  if (r.acceptedQuantity != null && site == null)
    problems.push(
      "Record the actual site count before recording the accepted quantity.",
    );
  if (site != null && accepted !== null && accepted > site)
    problems.push("The accepted quantity cannot exceed the actual site count.");
  const issue = !["confirmed", "unresolved"].includes(r.delivery);
  if (
    r.delivery === "confirmed" &&
    site != null &&
    line.quantity !== null &&
    Math.abs(site - line.quantity) > 1e-6
  )
    problems.push(
      "The site count differs from the paper quantity. Record the delivery issue.",
    );
  if (issue && site == null)
    problems.push(
      "Record the actual site count separately from the paper quantity.",
    );
  if (
    (issue ||
      r.specification.startsWith("substitution-") ||
      r.remainder ||
      r.excess) &&
    !r.note.trim()
  )
    problems.push(
      "Add a short explanation of the delivery or specification decision.",
    );
  if (
    r.delivery === "wrong" &&
    r.specification !== "substitution-accepted" &&
    accepted !== 0
  )
    problems.push(
      "Accept the substitution explicitly, or record zero accepted for the wrong part.",
    );
  if (item && accepted !== null && (line.kind ?? fallbackKind) === "delivery") {
    const pending = lines.filter(
      (l) =>
        !l.ignored &&
        (!l.approved || l.id === line.id) &&
        l.orderItemId === item.id &&
        (l.kind ?? fallbackKind) === "delivery",
    );
    const total = pending.reduce(
      (n, l) => n + (receivedLineQuantity(l) ?? 0),
      0,
    );
    const outstanding = Math.max(
      0,
      item.ordered -
        item.received +
        (line.approved?.kind === "delivery" ? line.approved.quantity : 0),
    );
    if (total < outstanding - 1e-6 && r.remainder !== "backordered")
      problems.push(
        r.remainder === "cancelled"
          ? "Cancellation is recorded; an authorized order correction is still required."
          : "Confirm whether the remaining quantity is backordered or resolve the unexplained remainder.",
      );
    if (total > outstanding + 1e-6 && r.excess !== "accepted")
      problems.push(
        "Accept the excess explicitly, or exclude the quantity being returned from the accepted count.",
      );
  }
  return problems;
}

/** Reassignment invalidates every decision tied to the previous counterpart or quantity. */
export function invalidateResolution(line: ReceivingLine) {
  if (!line.resolution) return;
  const previous = line.resolution;
  line.resolution = {
    ...newResolution(line, previous.by, previous.at),
    note: previous.note,
  };
  line.checked = false;
}

/** Split/merge only conserved amounts, all in one explicitly chosen unit, never approved receipts. */
export function assertAllocation(
  sources: ReceivingLine[],
  outputs: { quantity: number; unit: string }[],
  fallbackKind: ReceiptKind = "delivery",
) {
  if (
    !sources.length ||
    new Set(sources.map((l) => l.id)).size !== sources.length
  )
    throw Error("Choose distinct source lines.");
  if (sources.some((l) => l.approved ?? l.ignored))
    throw Error("Only unapproved, included lines can be allocated.");
  if (
    sources.some(
      (l) =>
        l.resolution?.siteQuantity != null ||
        l.resolution?.acceptedQuantity != null,
    )
  )
    throw Error("Undo the site count before allocating this printed line.");
  if (new Set(sources.map((l) => l.kind ?? fallbackKind)).size > 1)
    throw Error("Delivery and return lines cannot be combined.");
  const unit = receiptUnit(sources[0]!.unit);
  if (
    !unit ||
    sources.some((l) => receiptUnit(l.unit) !== unit) ||
    outputs.some((l) => receiptUnit(l.unit) !== unit)
  )
    throw Error(
      "Convert all source and output quantities to the same unit before allocating.",
    );
  const valid = (n: number | null) =>
    n !== null && Number.isFinite(n) && n > 0 && n <= 999999;
  if (
    sources.some((l) => !valid(l.quantity)) ||
    outputs.some((l) => !valid(l.quantity))
  )
    throw Error("Every allocation needs a positive quantity.");
  const total = (values: number[]) =>
    Math.round(values.reduce((n, v) => n + v, 0) * 1e6);
  if (
    total(sources.map((l) => l.quantity!)) !==
    total(outputs.map((l) => l.quantity))
  )
    throw Error(
      "Allocated quantities must add up to the source quantity. Correct the source reading first if it is wrong.",
    );
}

/** A return is explicit; a shortage or an unconfirmed mismatch alone is not a return. */
export function materialMarkedForReturn(line: ReceivingLine, kind: ReceiptKind) {
  const receiptKind = line.kind ?? kind;
  return receiptKind === "return-replacement" || receiptKind === "return-credit" ||
    line.resolution?.materialIssue === "supplier-return" || line.resolution?.excess === "return";
}
