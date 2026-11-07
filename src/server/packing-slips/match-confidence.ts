/** Match confidence: how sure everything read from a packing slip makes us
 * that it delivers each of a job's orders. Each order is weighed on its own, in
 * log-odds against an order we cannot see: the products the slip lists, the
 * ordered quantities it prints, the supplier it names, order numbers, and the
 * slip's date against when the order was sent. Only rivals the evidence cannot
 * rule out take certainty away, so a job full of lookalike orders does not
 * dilute a clear match, while two orders that fit equally both stay unsure. */
import {
  convertSlipQuantity,
  receiptUnit,
  type ReceiptOrderItem,
} from "~/lib/packing-slip-review";
import { daysBetween } from "~/lib/order-match-comparison";
import { FOUND, GENERIC, supplierNamed, type SlipOrder } from "./find-order";
import { lineScorer, prepareScoringLine } from "./match";

export type SlipEvidence = {
  lines: Array<{
    page: number;
    sku?: string | null;
    description?: string;
    evidence: string;
    /** Ordered quantity as printed on the slip. */
    ordered?: number | null;
    unit: string | null;
  }>;
  /** The supplier named in the slip's header. */
  supplier?: string | null;
  /** Everything read from the slip, header included. */
  text?: string;
  date?: string | null;
  /** The slip's own supplier order and delivery numbers. */
  numbers?: string[];
  /** The numbers on the job's other slips, and the order each was confirmed for. */
  earlier?: Array<{ orderId: string; numbers: string[] }>;
  /** What this slip's own review has received, by order item; it does not
   * count against the order the slip delivers. */
  received?: Record<string, number>;
};
export type CandidateOrder = SlipOrder & { sentAt: string | null };
export type OrderCertainty = {
  orderId: string;
  /** 0 to 99. */
  confidence: number;
  /** Order items found on the slip. */
  found: number;
  /** The evidence that moved the confidence most, strongest first. */
  notes: string[];
};

/** An order with no evidence, against one we cannot see, in log-odds. */
const START = -1.65;
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** A row's support for an order item: none at 0.55, full at FOUND. */
const support = (score: number) =>
  Math.min(1, Math.max(0, (score - 0.55) / (FOUND - 0.55)));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A supplier name read from a slip's header is this supplier's. */
export function sameSupplier(ours: string, read: string) {
  const a = squash(ours),
    b = squash(read);
  if (a.length >= 3 && a === b) return true;
  if (a.length >= 6 && b.includes(a)) return true;
  const words = ours
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w));
  const printed = new Set(read.toLowerCase().split(/[^a-z0-9]+/));
  return words.length > 0 && words.every((w) => printed.has(w));
}

/** Slips usually follow the order within two weeks; back orders follow later.
 * One dated well before the order was sent is very unlikely to be for it,
 * though an order entered after a phone call can trail it by a day or two. */
function dateWeight(gap: number, backOrder: boolean) {
  if (gap <= -3) return -2.5;
  if (gap === -2) return -1.2;
  if (gap === -1) return -0.3;
  if (gap <= 3) return 2;
  if (gap <= 14) return 1.5;
  if (gap <= 45) return backOrder ? 1 : 0.7;
  if (gap <= 180) return backOrder ? 0.5 : 0;
  return backOrder ? 0 : -1;
}
const dateNote = (gap: number) => {
  const span = (days: number) =>
    days >= 60 ? `${Math.round(days / 30)} months` : plural(days, "day");
  return gap === 0
    ? "Sent the same day as the slip"
    : gap > 0
      ? `Sent ${span(gap)} before the slip`
      : `Sent ${span(-gap)} after the slip date`;
};

export function matchConfidence(
  slip: SlipEvidence,
  orders: CandidateOrder[],
): OrderCertainty[] {
  const texts = slip.lines.map((l) =>
    [l.sku, l.description, l.evidence].filter(Boolean).join(" "),
  );
  // A description can wrap onto the next row.
  const variants = texts.map((text, i) =>
    [
      text,
      ...(slip.lines[i + 1]?.page === slip.lines[i]!.page
        ? [`${text} ${texts[i + 1]}`]
        : []),
    ].map((t) => prepareScoringLine({ code: "", text: t })),
  );
  const scored = orders.map((order) => {
    const score = lineScorer(order.items);
    const items = new Map<string, number>();
    const rows = variants.map((forms) => {
      let best = 0,
        top: string | null = null,
        margin = 0;
      for (const form of forms) {
        const matches = score(form);
        for (const s of matches)
          if (s.score > (items.get(s.itemId) ?? 0))
            items.set(s.itemId, s.score);
        const [first, second] = matches;
        if (first && first.score > best) {
          best = first.score;
          top = first.itemId;
          margin = first.score - (second?.score ?? 0);
        }
      }
      return { support: support(best), top, margin };
    });
    return { order, items, rows };
  });
  // Each row's two best orders, so every order can see its strongest rival.
  const leaders = variants.map((_, r) => {
    let first = 0,
      second = 0,
      by = -1;
    scored.forEach(({ rows }, i) => {
      const s = rows[r]!.support;
      if (s > first) [first, second, by] = [s, first, i];
      else if (s > second) second = s;
    });
    return { first, second, by };
  });
  const unread = leaders.reduce((sum, l) => sum + 1 - l.first, 0);
  const header = slip.supplier?.trim() ? slip.supplier : null;
  const named = new Set(
    header
      ? orders.flatMap((o) =>
          o.supplier && sameSupplier(o.supplier, header)
            ? [squash(o.supplier)]
            : [],
        )
      : [],
  );
  const text = [slip.text ?? "", ...texts, ...(slip.numbers ?? [])].join("\n");
  const tokens = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .map(squash),
  );
  // A supplier order or delivery number shared with slips confirmed for one
  // order. One shared with slips of several orders, such as a job number, says
  // nothing.
  const mine = new Set(
    (slip.numbers ?? [])
      .map(squash)
      .filter((n) => n.length >= 4 && /\d/.test(n)),
  );
  const owners = new Map<string, Set<string>>();
  for (const e of slip.earlier ?? [])
    for (const n of e.numbers.map(squash))
      if (mine.has(n))
        owners.set(n, (owners.get(n) ?? new Set()).add(e.orderId));
  const shared = new Set(
    [...owners.values()].flatMap((ids) => (ids.size === 1 ? [...ids] : [])),
  );

  const weighed = scored.map(({ order, items, rows }, i) => {
    const evidence: Array<{ weight: number; note?: string }> = [];
    const add = (weight: number, note?: string) => {
      if (weight) evidence.push({ weight, note });
    };
    const best = (item: ReceiptOrderItem) => support(items.get(item.id) ?? 0);
    const before = (item: ReceiptOrderItem) =>
      Math.max(0, item.received - (slip.received?.[item.id] ?? 0));
    const due = order.items.filter(
      (item) => item.ordered - before(item) > 1e-6,
    );
    const backOrder =
      due.length > 0 && order.items.some((i) => before(i) > 1e-6);

    // Products: many found are strong evidence, though reorders of the same
    // parts share them, so each further one counts for less.
    const found = Math.min(
      rows.reduce((sum, row) => sum + row.support, 0),
      order.items.reduce((sum, item) => sum + best(item), 0),
    );
    add(1.8 * Math.log1p(found));
    // A slip line another order explains and this one does not: suppliers
    // rarely ship what was not ordered.
    const foreign = Math.min(
      10,
      rows.reduce((sum, row, r) => {
        const l = leaders[r]!;
        return (
          sum + Math.max(0, (l.by === i ? l.second : l.first) - row.support)
        );
      }, 0),
    );
    add(
      -1.5 * foreign,
      Math.round(foreign) >= 1
        ? `${plural(Math.round(foreign), "slip line")} not on this order`
        : undefined,
    );
    // Items still due that the slip leaves out: partial shipments are common.
    const expected = due.length ? due : order.items;
    if (expected.length) {
      const share =
        expected.reduce((sum, item) => sum + best(item), 0) / expected.length;
      const missing = Math.round(expected.length * (1 - share));
      add(
        -1.8 * (1 - share),
        missing
          ? `${plural(missing, "ordered item")} not on the slip`
          : undefined,
      );
    }
    add(-0.3 * Math.min(5, unread));

    // Ordered quantities printed on the slip, on rows clearly one item.
    const agree = new Set<string>(),
      differ = new Set<string>();
    rows.forEach((row, r) => {
      const line = slip.lines[r]!,
        printed = line.ordered;
      if (printed == null || !row.top || row.support < 1 || row.margin < 0.1)
        return;
      const item = order.items.find((i) => i.id === row.top);
      if (!item) return;
      const unit = receiptUnit(line.unit);
      const amount = unit
        ? convertSlipQuantity(printed, line.unit, item, texts[r])
        : printed;
      if (amount === null) return;
      const targets = [
        item.ordered,
        item.originalOrdered,
        item.ordered - before(item),
      ];
      if (targets.some((t) => t !== undefined && Math.abs(t - amount) < 1e-6))
        agree.add(item.id);
      else if (unit === receiptUnit(item.unit)) differ.add(item.id);
    });
    for (const id of agree) differ.delete(id);
    add(
      Math.min(4, agree.size),
      agree.size
        ? `${agree.size} ordered ${agree.size === 1 ? "quantity agrees" : "quantities agree"}`
        : undefined,
    );
    add(
      -0.7 * Math.min(3, differ.size),
      differ.size
        ? `${differ.size} ordered ${differ.size === 1 ? "quantity differs" : "quantities differ"}`
        : undefined,
    );

    if (order.supplier && header) {
      if (named.has(squash(order.supplier)))
        add(1, "Supplier named on the slip");
      else if (named.size) add(-3, "The slip names another supplier");
      else add(-0.5);
    } else if (order.supplier) {
      const seen = supplierNamed(order.supplier, text);
      add(
        seen === 1 ? 0.8 : seen ? 0.2 : 0,
        seen === 1 ? "Supplier named on the slip" : undefined,
      );
    }
    const number = squash(order.orderNumber),
      ours = number.length >= 5 && tokens.has(number);
    if (ours) add(3.5, "Our order number is on the slip");
    if (shared.has(order.id))
      add(2.5, "Same supplier order as an earlier slip");
    if (order.items.length && !due.length) add(-1.5, "Already fully received");
    const gap = daysBetween(order.sentAt, slip.date);
    if (gap !== null) add(dateWeight(gap, backOrder), dateNote(gap));

    const odds = evidence.reduce((sum, e) => sum + e.weight, START);
    return {
      orderId: order.id,
      odds,
      found: order.items.filter((item) => (items.get(item.id) ?? 0) >= FOUND)
        .length,
      // One product could be a near miss, unless an order number backs it.
      sure: ours || shared.has(order.id) || found >= 2,
      evidence,
    };
  });
  // Against an order we cannot see, at even odds, and against every rival.
  const top = Math.max(0, ...weighed.map((w) => w.odds));
  const total =
    Math.exp(-top) +
    weighed.reduce((sum, w) => sum + Math.exp(w.odds - top), 0);
  return weighed
    .sort((a, b) => b.odds - a.odds)
    .map(({ orderId, odds, found, sure, evidence }) => {
      const confidence = Math.min(
        sure ? 99 : 80,
        Math.floor((100 * Math.exp(odds - top)) / total),
      );
      // What explains the number: the evidence for a likely order, against
      // an unlikely one.
      const side = confidence >= 50 ? 1 : -1;
      return {
        orderId,
        confidence,
        found,
        notes: evidence
          .filter((e) => e.note && side * e.weight >= 0.7)
          .sort((a, b) => side * (b.weight - a.weight))
          .slice(0, 2)
          .map((e) => e.note!),
      };
    });
}
