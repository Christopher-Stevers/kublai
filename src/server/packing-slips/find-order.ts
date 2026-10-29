/** Which of a job's sent orders a packing slip is for, from its OCR text.
 * Suppliers print their own order numbers, so the slip is matched on the
 * products it lists, with the supplier's name and our order number as extra
 * evidence. */
import { readSlipTable } from "./read-table";
import type { SlipWord } from "./ocr-rows";
import { receiptUnit, type ReceiptOrderItem } from "~/lib/packing-slip-review";
import { lineScorer, prepareScoringLine } from "./match";
import { EVIDENCE, prepared, type VisionAsk } from "./vision";

export type SlipOrder = {
  id: string;
  orderNumber: string;
  supplier: string | null;
  items: ReceiptOrderItem[];
};
export type OrderGuess = {
  orderId: string;
  score: number;
  /** Order items found on the slip. */
  found: number;
  supplier: boolean;
  /** Ordered quantities agreeing on distinct, product-matched rows. */
  quantityMatches: number;
};

/** A slip row explains an order item at this score. */
const FOUND = 0.75;
/** Words in supplier names that do not tell suppliers apart. */
const GENERIC = new Set(
  "and the inc ltd llc limited corp co company supply supplies supplier wholesale distribution distributors plumbing heating hydronics mechanical electric electrical industrial sales group canada".split(
    " ",
  ),
);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** 1 when the slip names the supplier, 0.4 for a short or common word only. */
export function supplierNamed(name: string | null, text: string) {
  if (!name) return 0;
  const squashed = squash(text);
  const whole = squash(name);
  if (whole.length >= 6 && squashed.includes(whole)) return 1;
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w));
  if (!words.length) return 0;
  const slipWords = new Set(text.toLowerCase().split(/[^a-z0-9]+/));
  const seen = words.filter(
    (w) => slipWords.has(w) || (w.length >= 7 && squashed.includes(w)),
  );
  if (
    seen.length === words.length &&
    (words.length > 1 || words[0]!.length >= 7)
  )
    return 1;
  return seen.length ? 0.4 : 0;
}

export function findOrder(
  rows: Array<{ page: number; text: string; words?: SlipWord[] }>,
  orders: SlipOrder[],
): { ranked: OrderGuess[]; confident: boolean } {
  // A description can wrap onto the next row.
  const lines = rows.map((row, i) => {
    const next = rows[i + 1];
    return [
      row.text,
      ...(next?.page === row.page ? [`${row.text} ${next.text}`] : []),
    ].map((text) => prepareScoringLine({ code: "", text }));
  });
  const text = rows.map((r) => r.text).join("\n");
  const table = readSlipTable(
    rows.map((r) => ({ ...r, words: r.words ?? [] })),
  );
  const explained = new Set<number>();
  const scored = orders.map((order) => {
    const score = lineScorer(order.items);
    const quantityItems = new Set<string>();
    for (const line of table.lines) {
      const raw = line.cells.ordered
        ?.map((w) => w.text)
        .join("")
        .replace(/,/g, "");
      if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) continue;
      // Only a recognized ordered column counts; never infer from prices,
      // line numbers, dimensions, or the shipped/backorder quantities.
      const matches = score(
        prepareScoringLine({
          code: line.cells.sku?.map((w) => w.text).join(" ") ?? "",
          text: line.text,
        }),
      );
      const top = matches[0];
      if (
        !top ||
        top.score < FOUND ||
        top.score - (matches[1]?.score ?? 0) < 0.1
      )
        continue;
      const item = order.items.find((i) => i.id === top.itemId);
      if (
        item &&
        line.cells.unit?.length &&
        receiptUnit(line.cells.unit.map(w => w.text).join(" ")) === receiptUnit(item.unit) &&
        !(item.piecesPerPack && item.piecesPerPack > 1) &&
        Number(raw) === item.ordered
      )
        quantityItems.add(item.id);
    }
    const best = new Map<string, number>();
    const rowsFound = new Set<number>();
    lines.forEach((variants, i) => {
      for (const variant of variants)
        for (const s of score(variant)) {
          if (s.score > (best.get(s.itemId) ?? 0)) best.set(s.itemId, s.score);
          if (s.score >= FOUND) {
            rowsFound.add(i);
            explained.add(i);
          }
        }
    });
    const recall = order.items.length
      ? order.items.reduce(
          (sum, item) =>
            sum +
            Math.min(
              1,
              Math.max(0, ((best.get(item.id) ?? 0) - 0.55) / (FOUND - 0.55)),
            ),
          0,
        ) / order.items.length
      : 0;
    const found = order.items.filter(
      (i) => (best.get(i.id) ?? 0) >= FOUND,
    ).length;
    return {
      order,
      recall,
      found,
      rowsFound,
      quantityMatches: quantityItems.size,
    };
  });
  const ranked = scored
    .map(({ order, recall, found, rowsFound, quantityMatches }) => {
      const precision = rowsFound.size / Math.max(1, explained.size);
      const fit =
        recall + precision
          ? (2 * recall * precision) / (recall + precision)
          : 0;
      const named = supplierNamed(order.supplier, text);
      const number = squash(order.orderNumber);
      const ours =
        number.length >= 5 &&
        text
          .toLowerCase()
          .split(/[^a-z0-9-]+/)
          .some((t) => squash(t) === number)
          ? 0.5
          : 0;
      const delivered =
        order.items.length > 0 &&
        order.items.every((i) => i.received >= i.ordered);
      return {
        orderId: order.id,
        score:
          Math.round(
            (fit +
              0.25 * named +
              ours +
              (0.25 * quantityMatches) / Math.max(1, found)) *
              (delivered ? 0.85 : 1) *
              1000,
          ) / 1000,
        found,
        quantityMatches,
        supplier: named === 1,
      };
    })
    .sort((a, b) => b.score - a.score);
  const [top, second] = ranked;
  const confident = Boolean(
    top &&
    top.found >= 2 &&
    top.score >= 0.9 &&
    top.score - (second?.score ?? 0) >= 0.3,
  );
  return { ranked, confident };
}

/** A review suggestion has a lower threshold than an automatic match.
 * Supplier alone or coincidental quantities cannot manufacture an order match. */
export function suggestedOrder(ranked: OrderGuess[]) {
  return ranked.find((g) => g.found >= 1 && g.score >= 0.35)?.orderId ?? null;
}

/** Jev compares all supplied pages, including products on continuation pages. */
export async function askWhichOrder(
  page: Buffer | Buffer[],
  candidates: SlipOrder[],
  ask: VisionAsk,
): Promise<{ orderId: string | null; confidence: number }> {
  const orders = candidates
    .map(
      (o, k) =>
        `Order ${k + 1}: supplier ${o.supplier ?? "unknown"}; products: ${o.items
          .map(
            (i) =>
              `${[i.sku, i.description].filter(Boolean).join(" ")} [ordered ${i.ordered} ${i.unit}]`,
          )
          .join("; ")}`,
    )
    .join("\n");
  const criteria: Record<string, string> = Object.fromEntries(
    candidates.map((_, k) => [`o${k + 1}`, `Order ${k + 1}`]),
  );
  criteria.none = "None of these orders";
  const answer = (
    await ask(
      {
        ...(await Promise.all(
          (Array.isArray(page) ? page : [page])
            .slice(0, 20)
            .map(
              async (p, i) =>
                [
                  i === 0 ? "slip" : `slip_page_${i + 1}`,
                  await prepared(p),
                ] as const,
            ),
        ).then(Object.fromEntries)),
        orders,
      },
      {
        order: {
          type: "choice",
          instructions: `Which of our purchase orders in \`orders\` is the packing slip in \`slip\` delivering? Compare the supplier, product identities and ordered quantities across ALL supplied slip pages with each order. Suggest the best-supported order even for a partial delivery or one discrepant item; item discrepancies require separate review. Suppliers usually print their own order number or job PO, not our internal order number. Missing internal order numbers do not rule out a match. Quantities support product identity but matching quantities alone are insufficient. ${EVIDENCE} Select none only when all candidates have weak evidence across these signals.`,
          criteria,
        },
      },
    )
  ).order;
  if (answer?.type !== "choice") return { orderId: null, confidence: 0 };
  const k = Number(answer.choice.slice(1)) - 1;
  return {
    orderId: answer.choice === "none" ? null : (candidates[k]?.id ?? null),
    confidence: answer.probabilities?.[answer.choice] ?? answer.confidence,
  };
}
