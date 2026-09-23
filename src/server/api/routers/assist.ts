import { askJevCached } from "~/server/assist/cached-jev";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { assertCanAccessTab } from "~/server/auth/permissions";
import {
  categories,
  jobFloors,
  jobRooms,
  jobs,
  materialLists,
  materials,
  partDefinitions,
  partSynonyms,
  quoteItems,
  quotes,
  sizes,
  supplierParts,
  suppliers,
  units,
} from "~/server/db/schema";
import { jevConfigured, JevError } from "~/server/assist/jev";
import {
  assistanceModes,
  duplicateTask,
  makeRequest,
  searchTask,
  suggestions,
  type AssistanceMode,
  type Part,
  type ReviewTask,
} from "~/server/assist/decisions";
import { summarizeRoomShape } from "~/server/assist/room-review";
import { readSheetText } from "~/server/assist/sheet-text";
import type { db as appDb } from "~/server/db";

const modeSchema = z.enum(assistanceModes);
const BATCH = 20;
const attempts = new Map<string, { until: number; count: number }>();
let active = 0;
function admit(userId: string) {
  const now = Date.now();
  for (const [key, value] of attempts)
    if (value.until < now) attempts.delete(key);
  const entry = attempts.get(userId) ?? { until: now + 600_000, count: 0 };
  if (entry.count >= 20 || active >= 4)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Please wait a minute before running more AI checks.",
    });
  entry.count++;
  attempts.set(userId, entry);
}
function requiredId(id?: string) {
  if (!id)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a record first.",
    });
  return id;
}
function notFound(): never {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Record not found in your organization.",
  });
}
function tab(mode: AssistanceMode) {
  return mode === "supplier"
    ? "suppliers"
    : mode === "catalogue" || mode === "search"
      ? "catalogue"
      : "dashboard";
}
const partFields = {
  id: partDefinitions.id,
  name: partDefinitions.displayName,
  description: partDefinitions.description,
  materialId: partDefinitions.materialId,
  material: materials.name,
  sizeId: partDefinitions.sizeId,
  size: sql<
    string | null
  >`coalesce(${partDefinitions.sizeLabel}, concat_ws(' ', ${sizes.nominal}, ${units.code}))`,
  categoryId: partDefinitions.categoryId,
  category: categories.name,
};
const aliases: Record<string, string[]> = {
  elbow: ["ell", "90", "45"],
  ell: ["elbow"],
  dwv: ["drain", "waste", "vent"],
  copper: ["cu"],
  cu: ["copper"],
  tee: ["te", "tee"],
  coupling: ["cplg", "coupler"],
  cplg: ["coupling"],
  pvc: ["polyvinyl"],
  abs: ["abs"],
};
export function searchWords(text: string) {
  const base =
    text
      .toLowerCase()
      .match(/\d+(?:[./]\d+)?|[a-z]+/g)
      ?.filter((word) => word.length > 1 || /\d/.test(word))
      .slice(0, 12) ?? [];
  return [
    ...new Set(base.flatMap((word) => [word, ...(aliases[word] ?? [])])),
  ].slice(0, 20);
}
async function parts(
  db: typeof appDb,
  org: string,
  search = "",
  id?: string,
  limit = BATCH,
): Promise<Part[]> {
  const words = searchWords(search);
  const haystack = sql`lower(concat_ws(' ', ${partDefinitions.displayName}, ${partDefinitions.description}, ${partDefinitions.sizeLabel}, ${materials.name}, ${categories.name}))`;
  const matches = words.map(
    (word) =>
      sql`(strpos(${haystack}, ${word}) > 0 or exists (select 1 from ${partSynonyms} where ${partSynonyms.partDefinitionId} = ${partDefinitions.id} and strpos(lower(${partSynonyms.synonym}), ${word}) > 0))`,
  );
  const rank = matches.length
    ? sql.join(
        matches.map((match) => sql`case when ${match} then 1 else 0 end`),
        sql` + `,
      )
    : sql`(0::integer)`;
  return db
    .select(partFields)
    .from(partDefinitions)
    .leftJoin(
      materials,
      and(
        eq(materials.id, partDefinitions.materialId),
        eq(materials.organizationId, org),
      ),
    )
    .leftJoin(
      categories,
      and(
        eq(categories.id, partDefinitions.categoryId),
        eq(categories.organizationId, org),
      ),
    )
    .leftJoin(
      sizes,
      and(eq(sizes.id, partDefinitions.sizeId), eq(sizes.organizationId, org)),
    )
    .leftJoin(units, eq(units.id, sizes.unitId))
    .where(
      and(
        eq(partDefinitions.organizationId, org),
        eq(partDefinitions.isActive, true),
        id ? eq(partDefinitions.id, id) : undefined,
        !id && matches.length ? or(...matches) : undefined,
      ),
    )
    .orderBy(
      desc(rank),
      asc(partDefinitions.displayName),
      asc(partDefinitions.id),
    )
    .limit(limit);
}

export const assistRouter = createTRPCRouter({
  status: hasDashboardAccess.query(() => ({ configured: jevConfigured() })),
  sources: hasDashboardAccess
    .input(
      z.object({ mode: modeSchema, search: z.string().max(200).default("") }),
    )
    .query(async ({ ctx, input }) => {
      assertCanAccessTab(ctx.user, tab(input.mode));
      const org = ctx.user.organizationId!;
      if (input.mode === "search") return [];
      if (input.mode === "catalogue")
        return (await parts(ctx.db, org, input.search, undefined, 50)).map(
          (p) => ({ id: p.id, label: p.name }),
        );
      if (input.mode === "supplier")
        return ctx.db
          .select({
            id: supplierParts.id,
            label: sql<string>`concat_ws(' — ', ${suppliers.name}, ${supplierParts.supplierName}, ${supplierParts.supplierSku})`,
          })
          .from(supplierParts)
          .innerJoin(
            suppliers,
            and(
              eq(suppliers.id, supplierParts.supplierId),
              eq(suppliers.organizationId, org),
            ),
          )
          .where(
            and(
              eq(supplierParts.organizationId, org),
              sql`strpos(lower(concat_ws(' ', ${suppliers.name}, ${supplierParts.supplierName}, ${supplierParts.supplierSku})), ${input.search.toLowerCase()}) > 0`,
            ),
          )
          .orderBy(asc(suppliers.name), asc(supplierParts.id))
          .limit(50);
      if (input.mode === "materials")
        return ctx.db
          .select({
            id: materialLists.id,
            label: sql<string>`concat_ws(' — ', ${jobs.name}, ${materialLists.name})`,
          })
          .from(materialLists)
          .innerJoin(
            jobs,
            and(eq(jobs.id, materialLists.jobId), eq(jobs.organizationId, org)),
          )
          .where(
            and(
              eq(materialLists.organizationId, org),
              sql`strpos(lower(concat_ws(' ', ${jobs.name}, ${materialLists.name})), ${input.search.toLowerCase()}) > 0`,
            ),
          )
          .orderBy(desc(materialLists.updatedAt), asc(materialLists.id))
          .limit(50);
      return ctx.db
        .select({
          id: jobFloors.id,
          label: sql<string>`concat_ws(' — ', ${jobs.name}, ${jobFloors.name})`,
        })
        .from(jobFloors)
        .innerJoin(
          jobs,
          and(eq(jobs.id, jobFloors.jobId), eq(jobs.organizationId, org)),
        )
        .where(
          and(
            eq(jobFloors.organizationId, org),
            sql`strpos(lower(concat_ws(' ', ${jobs.name}, ${jobFloors.name})), ${input.search.toLowerCase()}) > 0`,
          ),
        )
        .orderBy(desc(jobFloors.updatedAt), asc(jobFloors.id))
        .limit(50);
    }),
  run: hasDashboardAccess
    .input(
      z.object({
        mode: modeSchema,
        id: z.string().uuid().optional(),
        query: z.string().trim().max(500).default(""),
        offset: z.number().int().min(0).max(10000).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanAccessTab(ctx.user, tab(input.mode));
      if (input.mode === "supplier" || input.mode === "materials")
        assertCanAccessTab(ctx.user, "catalogue");
      if (!jevConfigured())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "AI assistance is not connected yet. Ask your administrator to configure TypeSafe.",
        });
      admit(ctx.userId);
      active++;
      const org = ctx.user.organizationId!;
      const tasks: ReviewTask[] = [];
      let nextOffset: number | null = null;
      let note = "Suggestions only. No records have been changed.";
      try {
        if (input.mode === "search") {
          if (input.query.length < 2 || !searchWords(input.query).length)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Describe the product you need.",
            });
          const candidates = await parts(ctx.db, org, input.query);
          tasks.push(...candidates.map((p) => searchTask(input.query, p)));
          note =
            "AI ranks up to 20 catalogue candidates found by words and trade aliases. Try different wording if the right product is missing.";
        } else if (input.mode === "catalogue") {
          const source =
            (await parts(ctx.db, org, "", requiredId(input.id), 1))[0] ??
            notFound();
          const categoryRows = await ctx.db
            .select({ id: categories.id, name: categories.name })
            .from(categories)
            .where(eq(categories.organizationId, org))
            .orderBy(asc(categories.name))
            .limit(254);
          if (categoryRows.length)
            tasks.push({
              id: `category:${source.id}`,
              title: `Category for ${source.name}`,
              question:
                "Choose the most appropriate supplied catalogue category for this product. If none fit or evidence is inadequate, choose uncertain.",
              options: {
                ...Object.fromEntries(categoryRows.map((c) => [c.id, c.name])),
                uncertain: "No confident category suggestion",
              },
              state: source,
              href: "/dashboard/catalogue",
              partId: source.id,
            });
          const candidates = (
            await parts(ctx.db, org, source.name, undefined, BATCH + 1)
          )
            .filter((p) => p.id !== source.id)
            .slice(0, BATCH);
          tasks.push(...candidates.map((p) => duplicateTask(source, p)));
          note =
            "Category suggestion and duplicate checks against up to 20 similar catalogue records. Nothing is merged or recategorized automatically.";
        } else if (input.mode === "supplier") {
          const [source] = await ctx.db
            .select({
              id: supplierParts.id,
              name: supplierParts.supplierName,
              sku: supplierParts.supplierSku,
              packSize: supplierParts.packSize,
              packUnit: units.code,
              partId: supplierParts.partDefinitionId,
            })
            .from(supplierParts)
            .leftJoin(units, eq(units.id, supplierParts.packUomId))
            .where(
              and(
                eq(supplierParts.id, requiredId(input.id)),
                eq(supplierParts.organizationId, org),
              ),
            )
            .limit(1);
          if (!source) notFound();
          const linked = (await parts(ctx.db, org, "", source.partId, 1))[0];
          const candidates = await parts(
            ctx.db,
            org,
            source.name || linked?.name || source.sku || "",
          );
          if (linked && !candidates.some((p) => p.id === linked.id))
            candidates.unshift(linked);
          tasks.push(
            ...candidates.slice(0, BATCH).map(
              (candidate): ReviewTask => ({
                id: `supplier:${source.id}:${candidate.id}`,
                title: `${source.name || source.sku || "Supplier listing"} ↔ ${candidate.name}`,
                question:
                  "Does this supplier listing identify this exact catalogue product? Check material, all dimensions, connections, grade and rating. A current link is NOT proof. Missing specifications or unknown pack equivalence mean uncertain. Never treat a box price as a unit price.",
                options: {
                  same: "Possible product match — verify pack quantities",
                  different: "Different products",
                  uncertain: "Insufficient product or pack specifications",
                },
                state: {
                  supplierListing: {
                    name: source.name,
                    sku: source.sku,
                    packSize: source.packSize,
                    packUnit: source.packUnit,
                  },
                  candidate,
                },
                forcedReview:
                  !source.packSize || !source.packUnit
                    ? "Supplier pack quantity or unit is missing."
                    : undefined,
                href: "/dashboard/catalogue",
                partId: candidate.id,
              }),
            ),
          );
        } else if (input.mode === "materials") {
          const [list] = await ctx.db
            .select({ id: materialLists.id, quoteId: materialLists.quoteId })
            .from(materialLists)
            .where(
              and(
                eq(materialLists.id, requiredId(input.id)),
                eq(materialLists.organizationId, org),
              ),
            )
            .limit(1);
          if (!list) notFound();
          if (list.quoteId) {
            const rows = await ctx.db
              .select({
                id: quoteItems.id,
                description: quoteItems.descriptionSnapshot,
                oneOffName: quoteItems.oneOffDisplayName,
                oneOffDescription: quoteItems.oneOffDescription,
                oneOffMaterial: quoteItems.oneOffMaterial,
                quantity: quoteItems.quantity,
                unit: units.code,
                partId: partDefinitions.id,
                partName: partDefinitions.displayName,
                partDescription: partDefinitions.description,
                size: partDefinitions.sizeLabel,
                material: materials.name,
              })
              .from(quoteItems)
              .innerJoin(
                quotes,
                and(
                  eq(quotes.id, quoteItems.quoteId),
                  eq(quotes.organizationId, org),
                ),
              )
              .leftJoin(
                partDefinitions,
                and(
                  eq(partDefinitions.id, quoteItems.partDefinitionId),
                  eq(partDefinitions.organizationId, org),
                ),
              )
              .leftJoin(
                materials,
                and(
                  eq(materials.id, partDefinitions.materialId),
                  eq(materials.organizationId, org),
                ),
              )
              .leftJoin(units, eq(units.id, quoteItems.uomId))
              .where(eq(quoteItems.quoteId, list.quoteId))
              .orderBy(asc(quoteItems.id))
              .limit(BATCH + 1)
              .offset(input.offset);
            if (rows.length > BATCH) nextOffset = input.offset + BATCH;
            tasks.push(
              ...rows.slice(0, BATCH).map(
                (row): ReviewTask => ({
                  id: `material:${row.id}`,
                  title:
                    row.description ||
                    row.partName ||
                    row.oneOffName ||
                    "Unnamed item",
                  question:
                    "Is this material-list description consistent with its selected product and unit? For one-off items assess whether the description identifies a product unambiguously. Flag explicit conflicts as mismatch and missing essential details as uncertain. Do not assess required quantities without a takeoff.",
                  options: {
                    consistent: "No obvious description conflict",
                    mismatch:
                      "Description or unit may conflict with the selected product",
                    uncertain: "More product details needed",
                  },
                  state: row,
                  forcedReview:
                    Number(row.quantity) <= 0
                      ? "Quantity is zero or negative."
                      : !row.unit
                        ? "Unit of measure is missing."
                        : undefined,
                  href: `/dashboard/material-lists/${list.id}`,
                }),
              ),
            );
          }
        } else {
          const [floor] = await ctx.db
            .select()
            .from(jobFloors)
            .where(
              and(
                eq(jobFloors.id, requiredId(input.id)),
                eq(jobFloors.organizationId, org),
              ),
            )
            .limit(1);
          if (!floor) notFound();
          const href = `/dashboard/jobs/${floor.jobId}/rooms`;
          if (input.mode === "sheets") {
            let text;
            try {
              text = await readSheetText(floor);
            } catch {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "Could not read this drawing’s text. The drawing has not changed.",
              });
            }
            if (!text.text.trim())
              return {
                results: [],
                nextOffset,
                note: "This drawing has no extractable text. Text recognition is needed before AI sheet classification.",
                model: null,
              };
            tasks.push({
              id: `sheet:${floor.id}`,
              title: floor.name,
              question:
                "Classify the main purpose of this drawing sheet. Use title-block and drawing headings, not an isolated incidental reference. Choose mixed if several purposes share the sheet.",
              options: {
                plan: "Floor plan",
                elevation: "Elevation",
                section: "Section",
                detail: "Details",
                schedule: "Schedule",
                site: "Site plan",
                mixed: "Mixed drawing types",
                uncertain: "Sheet type unclear",
              },
              state: { name: floor.name, extractedText: text.text },
              forcedReview: text.truncated
                ? "Only the first 24,000 characters of drawing text were checked."
                : undefined,
              href,
            });
          } else {
            const rows = await ctx.db
              .select({
                id: jobRooms.id,
                name: jobRooms.name,
                shape: jobRooms.shape,
                source: jobRooms.source,
              })
              .from(jobRooms)
              .where(
                and(
                  eq(jobRooms.floorId, floor.id),
                  eq(jobRooms.organizationId, org),
                  eq(jobRooms.confirmed, false),
                ),
              )
              .orderBy(asc(jobRooms.id))
              .limit(BATCH + 1)
              .offset(input.offset);
            if (rows.length > BATCH) nextOffset = input.offset + BATCH;
            tasks.push(
              ...rows.slice(0, BATCH).map(
                (row): ReviewTask => {
                  const geometry = summarizeRoomShape(row.shape);
                  return {
                  id: `room:${row.id}`,
                  title: row.name,
                  question:
                    "Does this unconfirmed room outline have obvious issues in its label or supplied normalized geometry (degenerate boundary, implausible extent, irregular shape needing inspection)? You cannot verify wall alignment without the drawing. Flag obvious issues as concern; choose uncertain when geometry is insufficient.",
                  options: {
                    plausible:
                      "No obvious issue in supplied geometry — verify against drawing",
                    concern: "Inspect this room outline first",
                    uncertain: "Outline needs visual review",
                  },
                  state: {
                    name: row.name,
                    source: row.source,
                    ...geometry,
                  },
                  forcedReview:
                    geometry.warning ?? undefined,
                  href,
                };
                },
              ),
            );
            note =
              "Unconfirmed outlines only; AI checks labels and geometry, not wall alignment. Open the drawing to verify. Approved outlines are unchanged.";
          }
        }
        if (!tasks.length)
          return {
            results: [],
            nextOffset,
            note: "No matching records to check. Try another selection or search.",
            model: null,
          };
        const response = await askJevCached(org, makeRequest(tasks));
        let results = suggestions(tasks, response.answers);
        if (input.mode === "search")
          results = results.sort(
            (a, b) =>
              Number(b.choice === "match") - Number(a.choice === "match") ||
              b.probability - a.probability,
          );
        return { results, nextOffset, note, model: response.model };
      } catch (error) {
        if (error instanceof JevError)
          throw new TRPCError({ code: "BAD_GATEWAY", message: error.message });
        throw error;
      } finally {
        active--;
      }
    }),
});
