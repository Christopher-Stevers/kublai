/** A message to the supplier about what a delivery got wrong, written from
 * the decisions already recorded in the review. The reviewer reads it and
 * sends it from their own mail app; nothing here sends anything. */
import type { ReceiptOrderItem } from "./packing-slip-review";
import { receivingQuantity } from "./receiving-quantity-display";
import { lineKind, type ReceivingReview } from "./receiving-review";
import { receivedLineQuantity } from "./receiving-resolution";

type Section =
  | "short"
  | "damaged"
  | "wrong"
  | "return"
  | "cancel"
  | "confirm"
  | "coming";
const HEADINGS: Record<Section, string> = {
  short: "Short",
  damaged: "Damaged",
  wrong: "Wrong or not as ordered",
  return: "Sent more than ordered, to be returned",
  cancel: "Please cancel",
  confirm: "Shipped less than ordered, not marked as backordered",
  coming: "Still to come",
};
/** Sections that are a problem with what arrived, not just what is still due. */
const PROBLEMS: Section[] = ["short", "damaged", "wrong", "return"];

export type SupplierClaim = {
  subject: string;
  body: string;
  /** Lines in the message, problems and items still due together. */
  count: number;
  /** Whether anything that arrived was short, damaged, wrong or extra. */
  problems: boolean;
};

const round = (n: number) => Math.round(n * 1000) / 1000;

function deliveredOn(date: string) {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!day) return "";
  const at = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  return Number.isNaN(at.getTime())
    ? ""
    : ` on ${at.toLocaleDateString(undefined, { dateStyle: "medium" })}`;
}

export function supplierClaim({
  review,
  items,
  orderNumber,
}: {
  review: ReceivingReview;
  items: ReceiptOrderItem[];
  orderNumber?: string | null;
}): SupplierClaim | null {
  const entries = new Map<Section, string[]>();
  const add = (section: Section, text: string, note = "") =>
    entries.set(section, [
      ...(entries.get(section) ?? []),
      `- ${text}${note ? `\n  Note: ${note}` : ""}`,
    ]);
  const item = (id: string | null) => items.find((i) => i.id === id);
  const named = (i: ReceiptOrderItem | undefined, fallback: string) => {
    const name =
      [i?.description, fallback].find((n) => n?.trim()) ?? "Unnamed item";
    const sku = i?.sku?.trim();
    return sku && !name.includes(sku) ? `${name} (${sku})` : name;
  };
  const delivery = review.lines.filter(
    (l) => !l.ignored && lineKind(l, review.kind) === "delivery",
  );
  /** Still due on the order after this slip's lines are counted, the way
   * receivingLineReady counts it: approved lines are already received. */
  const due = (i: ReceiptOrderItem) =>
    round(
      delivery
        .filter((l) => l.orderItemId === i.id)
        .reduce(
          (n, l) =>
            n +
            (l.approved?.kind === "delivery" ? l.approved.quantity : 0) -
            (receivedLineQuantity(l) ?? 0),
          i.ordered - i.received,
        ),
    );
  /** Order items whose remainder is already in the message. */
  const remainders = new Set<string>();
  let replace = false;

  for (const l of delivery) {
    const r = l.resolution;
    if (!r || r.skipped) continue;
    const i = item(l.orderItemId),
      name = named(i, l.description),
      q = (n: number) => receivingQuantity(round(n), i?.unit ?? l.unit),
      note = r.note.trim(),
      site = r.siteQuantity ?? null,
      paper = l.quantity,
      accepted = receivedLineQuantity(l);
    if (r.delivery === "short" || r.delivery === "damaged") replace = true;
    if (r.delivery === "short")
      add(
        "short",
        site !== null && paper !== null && paper > site
          ? `${name}: the slip shows ${q(paper)}, ${q(site)} arrived. Short ${q(paper - site)}.`
          : `${name}: less arrived than the slip shows.`,
        note,
      );
    if (r.delivery === "damaged") {
      const damaged =
        site !== null && accepted !== null ? round(site - accepted) : 0;
      add(
        "damaged",
        damaged > 0
          ? `${name}: ${q(site!)} arrived, ${q(damaged)} damaged.`
          : `${name}: arrived damaged.`,
        note,
      );
    }
    const wrong =
      r.delivery === "wrong" || r.specification === "substitution-rejected";
    const kept = r.specification === "substitution-accepted";
    if (
      wrong ||
      r.materialIssue === "shipped-mismatch" ||
      r.materialIssue === "supplier-return"
    ) {
      if (!kept) replace = true;
      add(
        "wrong",
        `${name}: ${
          r.materialIssue === "shipped-mismatch"
            ? "what arrived does not match the slip"
            : "the wrong item was sent"
        }${
          kept
            ? ". We are keeping it."
            : r.materialIssue === "supplier-return"
              ? ". It needs to be returned."
              : wrong
                ? ". We did not accept it."
                : "."
        }`,
        note,
      );
    }
    if (r.excess === "return") {
      const back = round((site ?? paper ?? 0) - (accepted ?? 0));
      add(
        "return",
        back > 0
          ? `${name}: ${q(back)} more than ordered was sent. We are returning it.`
          : `${name}: more than ordered was sent. We are returning the extra.`,
        note,
      );
    }
    if (i && r.remainder && !remainders.has(i.id)) {
      remainders.add(i.id);
      const left = due(i);
      if (left > 0 && r.remainder === "cancelled")
        add("cancel", `${name}: the remaining ${q(left)}.`, note);
      if (left > 0 && r.remainder === "unexplained")
        add(
          "confirm",
          `${name}: ${q(i.ordered)} ordered, ${q(paper ?? 0)} on this slip. Please confirm the remaining ${q(left)}.`,
          note,
        );
      if (left > 0 && r.remainder === "backordered")
        add("coming", `${name}: ${q(left)} backordered.`);
    }
  }
  // Order items the slip did not list, as the reviewer decided them.
  for (const [id, decision] of Object.entries(review.orderResolutions ?? {})) {
    const i = item(id);
    if (!i || decision.disposition === "unresolved" || remainders.has(id))
      continue;
    const left = due(i),
      q = (n: number) => receivingQuantity(n, i.unit);
    if (left <= 0) continue;
    if (decision.disposition === "cancel-requested")
      add("cancel", `${named(i, "")}: the ${q(left)} not delivered.`);
    else
      add(
        "coming",
        `${named(i, "")}: ${q(left)} ${decision.disposition === "backordered" ? "backordered" : "not on this delivery"}.`,
      );
  }
  if (!entries.size) return null;

  const has = (s: Section) => entries.has(s);
  const problems = PROBLEMS.some(has);
  const order = orderNumber?.trim() ? orderNumber.trim() : "our order";
  const slip = review.deliveryNumber.trim();
  const asks = [
    replace &&
      "Please send replacements or a credit for the short, damaged or wrong items.",
    has("return") && "Please arrange to collect what we are returning.",
    has("cancel") && "Please cancel the items listed and confirm.",
    (has("confirm") || has("coming")) &&
      "Please confirm when the remaining items will ship.",
  ].filter(Boolean);
  const sections = (Object.keys(HEADINGS) as Section[])
    .filter(has)
    .map((s) => `${HEADINGS[s]}\n${entries.get(s)!.join("\n")}`);
  const body = [
    `Hi ${review.supplierName.trim() || "there"},`,
    `We received ${slip ? `packing slip ${slip}` : "a delivery"} for ${order}${deliveredOn(review.deliveryDate)}. ${
      problems
        ? "Some items need your attention."
        : "Some items are still to come."
    }`,
    ...sections,
    asks.join(" "),
    "Thanks",
  ].join("\n\n");
  return {
    subject: `${problems ? "Delivery issue" : "Items still due"}: ${order}${slip ? `, packing slip ${slip}` : ""}`,
    body,
    count: [...entries.values()].reduce((n, e) => n + e.length, 0),
    problems,
  };
}
