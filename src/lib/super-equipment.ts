import { serializeCsv } from "./estimating/csv";

export type EquipmentCoverage = "matched" | "review" | "missing" | "incomplete";
export const equipmentCoverageLabels: Record<EquipmentCoverage, string> = {
  matched: "Submittal found",
  review: "Needs review",
  missing: "No submittal found",
  incomplete: "Search incomplete",
};
export type EquipmentEvidence = {
  documentId: string;
  name: string;
  version: number | null;
  status: string;
  url: string;
  pages: number[];
  reason: string;
  confirmed: boolean;
};
export type EquipmentReportLine = {
  id: string;
  tag: string;
  schedule: string;
  cells: string[];
  sheetId: string;
  sheet: string;
  set: string;
  page: number;
  sourceUrl: string;
  status: EquipmentCoverage;
  matches: EquipmentEvidence[];
};
/** Presence and approval are separate. A reference in an ordinary document is
 * only a candidate; never claim it proves there is an equipment submittal. */
export function equipmentCoverage(
  matches: EquipmentEvidence[],
  complete: boolean,
): EquipmentCoverage {
  if (matches.some((m) => m.confirmed)) return "matched";
  if (matches.length) return "review";
  return complete ? "missing" : "incomplete";
}
export function equipmentReportCsv(
  lines: EquipmentReportLine[],
  warnings: string[],
  generatedAt: string,
) {
  return serializeCsv([
    ["Generated", generatedAt],
    ["Search notes", warnings.join("; ")],
    [
      "Equipment",
      "Schedule",
      "Drawing set",
      "Sheet",
      "Page",
      "Schedule line",
      "Result",
      "Documents",
      "Document status",
      "Match evidence",
      "Schedule link",
      "Document links",
    ],
    ...lines.map((line) => [
      line.tag,
      line.schedule,
      line.set,
      line.sheet,
      line.page,
      line.cells.join(" | "),
      equipmentCoverageLabels[line.status],
      line.matches
        .map((m) => `${m.name}${m.version ? ` v${m.version}` : ""}`)
        .join("; "),
      line.matches.map((m) => m.status).join("; "),
      line.matches.map((m) => m.reason).join("; "),
      line.sourceUrl,
      line.matches.map((m) => m.url).join("; "),
    ]),
  ]);
}
