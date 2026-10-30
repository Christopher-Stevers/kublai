import type { SlipLine } from "~/lib/packing-slip-review";
import {
  receiptUnit,
  lineReadings,
  slipReading,
} from "~/lib/packing-slip-review";

export const CASCADE_POLICY = "ocr-jev-terra-2026-10-30.1";
export type CheapReading = {
  lines: SlipLine[];
  warnings: string[];
  model: string;
};
/** These are provisional routing rules, not calibrated accuracy thresholds. */
export function escalationPlan(reading: CheapReading, unresolvedOrder = false) {
  const reasons = new Set<string>();
  const lineIndexes: number[] = [];
  if (!reading.lines.length) reasons.add("No readable product rows");
  if (unresolvedOrder) reasons.add("Order match remains uncertain");
  if (
    reading.warnings.some((w) =>
      /could not be checked|no item table|check every line|could not.*read|could not finish|missing.*(?:line|page)|line count|total.*(?:differ|match)/i.test(
        w,
      ),
    )
  )
    reasons.add("Page coverage or totals need another reading");
  reading.lines.forEach((l, i) => {
    // A duplicate, a return disposition, or an absent printed unit needs a
    // person. Those facts alone never justify another paid model call.
    const unread =
      l.shipped === null &&
      !l.issues.some((s) =>
        /blank on the slip|ordered quantities only/i.test(s),
      );
    const uncertain = l.issues.some((s) =>
      /text is unclear|print is unclear|could not be read|quantity columns|do not add up|check backordered quantity|description only partly|only .*sure it is|matches more than one order line/i.test(
        s,
      ),
    );
    const unidentified =
      !l.orderItemId &&
      (!l.description?.trim() ||
        /unidentified|unreadable/i.test(l.description));
    const lowScore =
      (l.confidenceDetails?.part ?? 1) < 0.6 ||
      (l.shipped !== null && (l.confidenceDetails?.quantity ?? 1) < 0.8);
    if (unread || uncertain || unidentified || lowScore) {
      lineIndexes.push(i);
      reasons.add(
        unread
          ? "Unreadable shipped quantities"
          : unidentified
            ? "Unidentified products"
            : "Uncertain or conflicting line readings",
      );
    }
  });
  return { policy: CASCADE_POLICY, reasons: [...reasons], lineIndexes };
}
const norm = (s: string | null | undefined) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function overlap(a: SlipLine, b: SlipLine) {
  if (a.page !== b.page || !a.box || !b.box) return 0;
  return (
    Math.max(
      0,
      Math.min(a.box.y + a.box.height, b.box.y + b.box.height) -
        Math.max(a.box.y, b.box.y),
    ) / Math.max(0.0001, Math.min(a.box.height, b.box.height))
  );
}
export function sameLine(a: SlipLine, b: SlipLine) {
  if (a.page !== b.page) return false;
  if (overlap(a, b) >= 0.5) return true;
  if (norm(a.sku) && norm(a.sku) === norm(b.sku)) return true;
  return norm(a.evidence).length > 10 && norm(a.evidence) === norm(b.evidence);
}
function conflict(a: SlipLine, b: SlipLine) {
  return (
    a.orderItemId !== b.orderItemId ||
    (a.shipped !== null && b.shipped !== null && a.shipped !== b.shipped) ||
    (!!a.unit && !!b.unit && receiptUnit(a.unit) !== receiptUnit(b.unit)) ||
    (a.backordered !== null &&
      b.backordered !== null &&
      a.backordered !== b.backordered)
  );
}
/** Keep clear cheap readings. All assisted/new/conflicting rows still require review. */
export function mergeAssistedLines(
  base: SlipLine[],
  assisted: SlipLine[],
  targets: number[],
) {
  const lines = structuredClone(base),
    warnings: string[] = [];
  const used = new Set<number>(),
    touched = new Set<number>();
  for (const candidate of assisted) {
    const matches = base.flatMap((l, i) => (sameLine(l, candidate) ? [i] : []));
    if (
      matches.length === 1 &&
      assisted.filter((l) => sameLine(base[matches[0]!]!, l)).length === 1
    ) {
      const i = matches[0]!,
        old = base[i]!;
      used.add(i);
      if (targets.includes(i)) {
        lines[i] = {
          ...candidate,
          issues: [
            ...new Set([
              ...candidate.issues,
              ...old.issues.map((s) => `Earlier reading: ${s}`),
            ]),
          ],
          proposed: null,
          quantityClear: false,
          readings: [...lineReadings(old), slipReading(candidate)],
        };
        if (conflict(old, candidate))
          lines[i].issues.push(
            "Readers disagree. Check this line against the source before approving.",
          );
      } else {
        lines[i]!.readings = [...lineReadings(old), slipReading(candidate)];
        if (!conflict(old, candidate)) continue;
        lines[i]!.issues.push(
          "Terra disagrees with the earlier reading. Check the source before approving.",
        );
        lines[i]!.proposed = null;
        lines[i]!.quantityClear = false;
      }
    } else if (
      matches.length ||
      base.some((l) => overlap(l, candidate) > 0.15)
    ) {
      base.forEach((l, i) => {
        if (matches.includes(i) || overlap(l, candidate) > 0.15) touched.add(i);
      });
      warnings.push(
        `Page ${candidate.page}: another reading could not be aligned safely; check for split or missing lines.`,
      );
    } else {
      lines.push({
        ...candidate,
        proposed: null,
        quantityClear: false,
        issues: [
          ...candidate.issues,
          "Additional line found by Terra. Verify it is a separate printed line before approving.",
        ],
      });
    }
  }
  for (const i of targets)
    if (!used.has(i) && base[i]) {
      // Nothing Terra read lies on this row: likely a carton, total or note.
      if (!touched.has(i)) {
        lines[i]!.terraFoundNothing = true;
        lines[i]!.issues.push(
          "Terra found no product on this row. It may be a carton, total or note line.",
        );
      } else
        lines[i]!.issues.push(
          "Terra could not resolve this row. The earlier reading was kept for manual review.",
        );
    }
  return { lines, warnings: [...new Set(warnings)] };
}
