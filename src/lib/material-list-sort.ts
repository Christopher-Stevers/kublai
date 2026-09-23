export type MaterialListSort = "material" | "supplier" | "recent";
export const MATERIAL_LIST_SORT_OPTIONS = [
  { value: "material", label: "Catalog → material → size → category → name" },
  { value: "supplier", label: "Supplier" },
  { value: "recent", label: "Recently added" },
] as const;
export function isMaterialListSort(value: unknown): value is MaterialListSort {
  return value === "material" || value === "supplier" || value === "recent";
}

export type NameKeywordGroup = { includes: string; excludes: string };
export const EMPTY_NAME_KEYWORD_GROUPS: readonly NameKeywordGroup[] = [];
/** Preserve existing single-box preferences as Includes with no exclusions. */
export function parseNameKeywordGroups(value: unknown): NameKeywordGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((group): NameKeywordGroup[] => {
    if (typeof group === "string") return [{ includes: group, excludes: "" }];
    if (
      group &&
      typeof group === "object" &&
      typeof group.includes === "string" &&
      typeof group.excludes === "string"
    ) {
      return [{ includes: group.includes, excludes: group.excludes }];
    }
    return [];
  });
}
export const EXAMPLE_NAME_KEYWORD_GROUPS = [
  "Pipe, tubing",
  "Elbow, 90, 45",
  "Tee, wye",
  "Coupling, coupler",
  "Adapter, adaptor",
].map((includes) => ({ includes, excludes: "" }));
function normalizeKeywordText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
/** First matching group wins; match complete words/phrases, never substrings. */
function compileKeywordGroups(groups: readonly (NameKeywordGroup | string)[]) {
  const split = (text: string) =>
    text.split(",").map(normalizeKeywordText).filter(Boolean);
  return parseNameKeywordGroups(groups).map((group) => ({
    includes: split(group.includes),
    excludes: split(group.excludes),
  }));
}
function nameKeywordRank(
  name: string,
  groups: ReturnType<typeof compileKeywordGroups>,
) {
  const text = ` ${normalizeKeywordText(name)} `;
  const matches = (keyword: string) => text.includes(` ${keyword} `);
  const index = groups.findIndex(
    (group) => group.includes.some(matches) && !group.excludes.some(matches),
  );
  return index < 0 ? groups.length : index;
}

type SortableItem = {
  id: string;
  partDefinitionId?: string | null;
  descriptionSnapshot?: string | null;
  createdAt?: string | null;
  supplierId?: string | null;
  partDefinition?: {
    id: string;
    displayName: string;
    material: string | null;
  } | null;
  supplierPart?: {
    supplierId: string;
    supplier?: { name: string } | null;
  } | null;
};
type CataloguePart = {
  id: string;
  displayName: string;
  material: string | null;
  sizeNominal: number | string | null;
  sizeUnit: string | null;
  sizeLabel?: string | null;
  categoryId?: string | null;
  catalogId?: string | null;
};
const compare = new Intl.Collator("en", { numeric: true, sensitivity: "base" })
  .compare;
const fractions: Record<string, string> = {
  "¼": "1/4",
  "½": "1/2",
  "¾": "3/4",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};
function sizeValue(text: string): number | null {
  const normalized = text
    .replace(/([¼½¾⅛⅜⅝⅞])/g, (_, f: string) => ` ${fractions[f]}`)
    .trim();
  const match = normalized.match(
    /^(?:(\d+)[\s-]+)?(\d+)\s*\/\s*(\d+)|^(\d+(?:\.\d+)?)/,
  );
  if (!match) return null;
  const value = match[4]
    ? Number(match[4])
    : Number(match[1] ?? 0) + Number(match[2]) / Number(match[3]);
  return Number.isFinite(value) && value > 0 ? value : null;
}
function sizeInInches(
  part: CataloguePart | undefined,
  name: string,
): number | null {
  // Prefer the actual nominal size; pipe lengths and fitting angles in names
  // must never override catalogue dimensions.
  const nominal =
    part?.sizeNominal == null ? null : sizeValue(String(part.sizeNominal));
  const source = part?.sizeLabel || name;
  const value = nominal ?? sizeValue(source);
  if (value == null) return null;
  const unit = (
    nominal != null
      ? part?.sizeUnit
      : source.match(/^[\d\s./¼½¾⅛⅜⅝⅞-]+(mm|cm|inches|inch|in|["″])/i)?.[1]
  )?.toLowerCase();
  if (unit === "mm") return value / 25.4;
  if (unit === "cm") return value / 2.54;
  // Without catalogue dimensions, only treat a leading number as a size if
  // a unit marker follows it. A '90 degree elbow' has no known size.
  if (nominal == null && !unit) return null;
  return value;
}
function knownText(a: string, b: string) {
  return !a ? (!b ? 0 : 1) : !b ? -1 : compare(a, b);
}
const catalogueLookups = new WeakMap<readonly CataloguePart[], Map<string, CataloguePart>>();
function catalogueLookup(catalogue: readonly CataloguePart[]) {
  let lookup = catalogueLookups.get(catalogue);
  if (!lookup) {
    lookup = new Map(catalogue.map(part => [part.id, part]));
    catalogueLookups.set(catalogue, lookup);
  }
  return lookup;
}
export function sortMaterialListItems<T extends SortableItem>(
  items: readonly T[],
  mode: MaterialListSort,
  catalogue: readonly CataloguePart[] = [],
  suppliers: readonly { id: string; name: string }[] = [],
  categories: readonly { id: string; name: string }[] = [],
  keywordGroups: readonly (
    | NameKeywordGroup
    | string
  )[] = EMPTY_NAME_KEYWORD_GROUPS,
  catalogs: readonly { id: string; name: string }[] = [],
): T[] {
  const catalogNames = new Map(catalogs.map(catalog => [catalog.id, catalog.name]));
  const compiledGroups = compileKeywordGroups(keywordGroups);
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.name]),
  );
  const parts = catalogueLookup(catalogue);
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));
  const rows = items.map((item) => {
    const part = parts.get(
      item.partDefinitionId ?? item.partDefinition?.id ?? "",
    );
    const name =
      item.partDefinition?.displayName ||
      part?.displayName ||
      item.descriptionSnapshot ||
      "";
    const supplierId = item.supplierId ?? item.supplierPart?.supplierId;
    return {
      item,
      name,
      keywordRank: nameKeywordRank(name, compiledGroups),
      catalog: (catalogNames.get(part?.catalogId ?? "") ?? "").trim(),
      material: (part?.material || item.partDefinition?.material || "").trim(),
      size: sizeInInches(part, name),
      category: (categoryNames.get(part?.categoryId ?? "") ?? "").trim(),
      supplier: (
        supplierNames.get(supplierId ?? "") ||
        (item.supplierPart?.supplierId === supplierId
          ? item.supplierPart?.supplier?.name
          : "") ||
        ""
      ).trim(),
      created: item.createdAt ? Date.parse(item.createdAt) : NaN,
    };
  });
  const materialOrder = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    knownText(a.catalog, b.catalog) ||
    knownText(a.material, b.material) ||
    (a.size == null
      ? b.size == null
        ? 0
        : 1
      : b.size == null
        ? -1
        : a.size - b.size) ||
    knownText(a.category, b.category) ||
    a.keywordRank - b.keywordRank ||
    compare(a.name, b.name) ||
    compare(a.item.id, b.item.id);
  return rows
    .sort((a, b) => {
      if (mode === "supplier")
        return knownText(a.supplier, b.supplier) || materialOrder(a, b);
      if (mode === "recent") {
        const aKnown = Number.isFinite(a.created),
          bKnown = Number.isFinite(b.created);
        const newest =
          aKnown && bKnown
            ? b.created - a.created
            : aKnown
              ? -1
              : bKnown
                ? 1
                : 0;
        return newest || materialOrder(a, b);
      }
      return materialOrder(a, b);
    })
    .map((row) => row.item);
}

/** Catalogue choices have no list supplier or added-to-list date yet, so those
 * modes use the same catalog/material/size/category/name fallback as unassigned list items. */
export function sortMaterialListPartChoices<T extends CataloguePart>(
  parts: readonly T[],
  mode: MaterialListSort,
  categories: readonly { id: string; name: string }[] = [],
  keywordGroups: readonly (
    | NameKeywordGroup
    | string
  )[] = EMPTY_NAME_KEYWORD_GROUPS,
  catalogs: readonly { id: string; name: string }[] = [],
): T[] {
  return sortMaterialListItems(
    parts.map((part) => ({ id: part.id, partDefinitionId: part.id, part })),
    mode,
    parts,
    [],
    categories,
    keywordGroups,
    catalogs,
  ).map((row) => row.part);
}
