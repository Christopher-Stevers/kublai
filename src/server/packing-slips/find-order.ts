/** Which of a job's sent orders a packing slip is for, from its OCR text.
 * Suppliers print their own order numbers, so the slip is matched on the
 * products it lists, with the supplier's name and our order number as extra
 * evidence. */
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";
import { lineScorer } from "./match";
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
  rows: Array<{ page: number; text: string }>,
  orders: SlipOrder[],
): { ranked: OrderGuess[]; confident: boolean } {
  // A description can wrap onto the next row.
  const lines = rows.map((row, i) => {
    const next = rows[i + 1];
    return [
      row.text,
      ...(next?.page === row.page ? [`${row.text} ${next.text}`] : []),
    ];
  });
  const text = rows.map((r) => r.text).join("\n");
  const explained = new Set<number>();
  const scored = orders.map((order) => {
    const score = lineScorer(order.items);
    const best = new Map<string, number>();
    const rowsFound = new Set<number>();
    lines.forEach((variants, i) => {
      for (const variant of variants)
        for (const s of score({ code: "", text: variant })) {
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
    return { order, recall, found, rowsFound };
  });
  const ranked = scored
    .map(({ order, recall, found, rowsFound }) => {
      const precision = rowsFound.size / Math.max(1, explained.size);
      const fit =
        recall + precision
          ? (2 * recall * precision) / (recall + precision)
          : 0;
      const named = supplierNamed(order.supplier, text);
      const number = squash(order.orderNumber);
      const ours =
        number.length >= 5 && text.toLowerCase().split(/[^a-z0-9-]+/).some(t=>squash(t)===number) ? 0.5 : 0;
      const delivered =
        order.items.length > 0 &&
        order.items.every((i) => i.received >= i.ordered);
      return {
        orderId: order.id,
        score:
          Math.round(
            (fit + 0.25 * named + ours) * (delivered ? 0.85 : 1) * 1000,
          ) / 1000,
        found,
        supplier: named === 1,
      };
    })
    .sort((a, b) => b.score - a.score);
  const [top, second] = ranked;
  const confident = Boolean(
    top && top.found >= 2 && top.score >= 0.9 && top.score - (second?.score ?? 0) >= 0.3,
  );
  return { ranked, confident };
}

/** Jev's pick among the closest orders, from the first page's image. */
export async function askWhichOrder(
  page: Buffer,
  candidates: SlipOrder[],
  ask: VisionAsk,
): Promise<{ orderId: string | null; confidence: number }> {
  const orders = candidates
    .map(
      (o, k) =>
        `Order ${k + 1}: supplier ${o.supplier ?? "unknown"}; products: ${o.items
          .slice(0, 20)
          .map((i) => [i.sku, i.description].filter(Boolean).join(" "))
          .join("; ")}`,
    )
    .join("\n");
  const criteria: Record<string, string> = Object.fromEntries(
    candidates.map((_, k) => [`o${k + 1}`, `Order ${k + 1}`]),
  );
  criteria.none = "None of these orders";
  const answer = (
    await ask(
      { slip: await prepared(page), orders },
      {
        order: {
          type: "choice",
          instructions: `Which of our purchase orders in \`orders\` is the packing slip in \`slip\` delivering? Compare the supplier and the products on the slip with each order. ${EVIDENCE} Select none if the slip's products are not from any of these orders.`,
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
