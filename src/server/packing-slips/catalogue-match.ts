/** Ranks catalogue parts for slip lines that are not on the order, so the
 * reviewer can add the likely part to the material list. Uses the same
 * sizes, abbreviations and code shapes as order matching. */
import { and, eq } from "drizzle-orm";
import type { db as Db } from "~/server/db";
import {
  catalogs,
  partDefinitions,
  partSynonyms,
  supplierParts,
} from "~/server/db/schema";
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";
import { lineScorer, prepareScoringLine, skuScore } from "./match";

export type CataloguePart = {
  id: string;
  name: string;
  description: string | null;
  photoUrl: string | null;
  catalogId: string;
  unit: string | null;
  piecesPerPack: number | null;
  individualUnit: string | null;
  /** Synonyms, and what this supplier has called it on earlier slips. */
  aliases: string[];
  /** This supplier's codes for it. */
  codes: string[];
};
export type LikelyPart = Omit<CataloguePart, "aliases" | "codes"> & {
  score: number;
  /** The slip printed this supplier's code for it. */
  code: boolean;
};

const item = (sku: string | null, rest: Partial<ReceiptOrderItem> = {}) =>
  ({
    id: "",
    description: "",
    aliases: [],
    sku,
    ordered: 0,
    received: 0,
    verificationStatus: "",
    unit: "",
    piecesPerPack: null,
    individualUnit: null,
    ...rest,
  }) satisfies ReceiptOrderItem;

const likelyPart = (
  p: CataloguePart,
  score: number,
  code: boolean,
): LikelyPart => ({
  id: p.id,
  name: p.name,
  description: p.description,
  photoUrl: p.photoUrl,
  catalogId: p.catalogId,
  unit: p.unit,
  piecesPerPack: p.piecesPerPack,
  individualUnit: p.individualUnit,
  score,
  code,
});

export function catalogueRanker(parts: CataloguePart[]) {
  const score = lineScorer(
    parts.map((p) =>
      item(null, {
        id: p.id,
        description: p.name,
        aliases: [...p.aliases, ...(p.description ? [p.description] : [])],
      }),
    ),
  );
  const byId = new Map(parts.map((p) => [p.id, p])),
    seen = new Map<string, LikelyPart[]>();
  /** With `typed`, a part whose name contains the text is kept at any score. */
  const rank = (
    line: { code: string; text: string },
    { limit = 3, min = 0.3, typed = false } = {},
  ): LikelyPart[] => {
    if (!parts.length || !(line.code + line.text).trim()) return [];
    const key = `${limit}:${min}:${typed}:${line.code}\n${line.text}`,
      hit = seen.get(key);
    if (hit) return hit;
    const prepared = prepareScoringLine(line),
      text = line.text.trim().toLowerCase();
    const ranked = score(prepared)
      .map((s) => {
        const part = byId.get(s.itemId)!;
        const sku = Math.max(
          0,
          ...part.codes.map((c) =>
            skuScore(item(c), line.code, line.text, prepared.skuEvidence),
          ),
        );
        // A supplier code decides, as on the order.
        const value =
          sku >= 0.9
            ? 0.9 + 0.1 * s.score
            : Math.min(0.89, s.score + (sku ? 0.1 : 0));
        return likelyPart(part, value, sku >= 0.9);
      })
      .filter(
        (p) =>
          p.score >= min ||
          (typed && !!text && p.name.toLowerCase().includes(text)),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    // The Receive screen asks again every few seconds.
    if (seen.size > 500) seen.clear();
    seen.set(key, ranked);
    return ranked;
  };
  /** A part already chosen for the line, shown first. */
  const part = (id: string) => {
    const p = byId.get(id);
    return p && likelyPart(p, 1, false);
  };
  return Object.assign(rank, { part });
}

type Ranker = ReturnType<typeof catalogueRanker>;
const TTL = 120_000;
const cache = new Map<string, { at: number; ranker: Promise<Ranker> }>();

/** Drops cached parts after the catalogue or a supplier listing changes. */
export function forgetCatalogue(organizationId: string) {
  for (const key of cache.keys())
    if (key.startsWith(`${organizationId}:`)) cache.delete(key);
}

/** The organization's material parts, with this supplier's names and codes.
 * Cached briefly, as the Receive screen reloads every few seconds. */
export function catalogueFor(
  db: Pick<typeof Db, "select">,
  organizationId: string,
  supplierId: string | null,
) {
  const key = `${organizationId}:${supplierId ?? ""}`,
    hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.ranker;
  const ranker = loadCatalogue(db, organizationId, supplierId).then(
    catalogueRanker,
  );
  cache.set(key, { at: Date.now(), ranker });
  ranker.catch(() => cache.delete(key));
  return ranker;
}

async function loadCatalogue(
  db: Pick<typeof Db, "select">,
  organizationId: string,
  supplierId: string | null,
): Promise<CataloguePart[]> {
  const [parts, synonyms, listings] = await Promise.all([
    db
      .select({
        id: partDefinitions.id,
        name: partDefinitions.displayName,
        description: partDefinitions.description,
        photoUrl: partDefinitions.imageUrl,
        catalogId: partDefinitions.catalogId,
        unit: partDefinitions.bulkUnit,
        piecesPerPack: partDefinitions.piecesPerPack,
        individualUnit: partDefinitions.individualUnit,
      })
      .from(partDefinitions)
      .innerJoin(
        catalogs,
        and(
          eq(catalogs.id, partDefinitions.catalogId),
          eq(catalogs.kind, "materials"),
        ),
      )
      .where(
        and(
          eq(partDefinitions.organizationId, organizationId),
          eq(partDefinitions.isActive, true),
        ),
      ),
    db
      .select({
        partId: partSynonyms.partDefinitionId,
        text: partSynonyms.synonym,
      })
      .from(partSynonyms)
      .innerJoin(
        partDefinitions,
        eq(partDefinitions.id, partSynonyms.partDefinitionId),
      )
      .where(eq(partDefinitions.organizationId, organizationId)),
    supplierId
      ? db
          .select({
            partId: supplierParts.partDefinitionId,
            code: supplierParts.supplierSku,
            text: supplierParts.supplierName,
          })
          .from(supplierParts)
          .where(
            and(
              eq(supplierParts.organizationId, organizationId),
              eq(supplierParts.supplierId, supplierId),
            ),
          )
      : Promise.resolve([]),
  ]);
  const extra = new Map<string, { aliases: string[]; codes: string[] }>();
  const of = (id: string) => {
    let e = extra.get(id);
    if (!e) extra.set(id, (e = { aliases: [], codes: [] }));
    return e;
  };
  for (const s of synonyms) of(s.partId).aliases.push(s.text);
  for (const l of listings) {
    if (l.text?.trim()) of(l.partId).aliases.push(l.text);
    if (l.code?.trim()) of(l.partId).codes.push(l.code);
  }
  return parts.map((p) => ({
    ...p,
    aliases: [...new Set(extra.get(p.id)?.aliases)],
    codes: [...new Set(extra.get(p.id)?.codes)],
  }));
}
