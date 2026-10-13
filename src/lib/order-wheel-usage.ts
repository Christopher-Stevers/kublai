import { formatSizeDimensions } from "./size-utils";
export type WheelUsage = Record<string, number>;
export const wheelUsageId = (title: string, label: string) =>
  JSON.stringify([title, label]);
export type OrderedFacet = {
  catalog: string;
  material: string | null;
  groupPath: string[] | null;
  category: string | null;
  nominal: string | null;
  unit: string | null;
  sizeLabel: string | null;
  frequency: number;
};
/** Input is distinct (order, part) occurrences, not units or duplicate room rows. */
export function orderWheelUsage(rows: OrderedFacet[]): WheelUsage {
  const usage: WheelUsage = {};
  for (const row of rows) {
    const keys = new Set<string>();
    const add = (title: string, label: string) =>
      keys.add(wheelUsageId(title, label));
    add("Select Catalog", row.catalog);
    if (row.material) add("Select Material", row.material);
    if (row.category) add("Select Category", row.category);
    if (row.nominal !== null && row.unit) {
      add(
        "Select Size",
        formatSizeDimensions(row.sizeLabel || Number(row.nominal), row.unit),
      );
    }
    for (const key of keys)
      usage[key] = (usage[key] ?? 0) + Number(row.frequency);
  }
  return usage;
}
