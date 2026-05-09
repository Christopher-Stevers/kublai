import { z } from "zod";
import type { db as appDb } from "~/server/db";
import {
  sql,
  and,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  isNotNull,
  gte,
  lte,
} from "drizzle-orm";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { assertCanDeleteCoreRecords } from "~/server/auth/permissions";
import {
  categories,
  catalogs,
  partDefinitions,
  partAttributes,
  partSynonyms,
  units,
  supplierParts,
  suppliers,
  materials,
  sizes,
  quoteItems,
  orderItems,
} from "~/server/db/schema";

import {
  formatSize,
  formatSizeDimensions,
  generatePartDisplayName,
  parseSizeInput,
} from "~/lib/size-utils";

function normalizeAliases(input: string | string[] | null | undefined) {
  const aliases = Array.isArray(input) ? input : (input ?? "").split(/[;,\n]/);

  return Array.from(
    new Set(
      aliases
        .map((alias) => alias.trim())
        .filter((alias) => alias.length > 0)
        .map((alias) => alias.slice(0, 255)),
    ),
  );
}

const partImageUrlInput = z
  .preprocess(
    (value) => (value === "" ? null : value),
    z.string().nullable().optional(),
  )
  .refine(
    (value) => {
      if (!value) return true;
      if (value.startsWith("/api/catalogue/images/")) return true;
      if (value.startsWith("/images/catalog/uploads/")) return true;

      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    {
      message:
        "Image URL must be an absolute URL or an uploaded catalogue image path",
    },
  );

async function syncPartAliases(
  database: typeof appDb,
  partDefinitionId: string,
  aliases: string | string[],
) {
  const normalizedAliases = normalizeAliases(aliases);

  await database
    .delete(partSynonyms)
    .where(eq(partSynonyms.partDefinitionId, partDefinitionId));

  if (normalizedAliases.length > 0) {
    await database.insert(partSynonyms).values(
      normalizedAliases.map((synonym) => ({
        partDefinitionId,
        synonym,
      })),
    );
  }
}

// Helper function to find or create a size record
async function findOrCreateSize(
  db: Parameters<
    Parameters<typeof hasDashboardAccess.query>[0]
  >[0]["ctx"]["db"],
  organizationId: string,
  sizeNominal: number | string | null | undefined,
  sizeUnitId: string | null | undefined,
): Promise<string | null> {
  if (
    sizeNominal === undefined ||
    sizeNominal === null ||
    sizeNominal === "" ||
    !sizeUnitId
  ) {
    return null;
  }

  const parsedSizeNominal =
    typeof sizeNominal === "string"
      ? parseSizeInput(sizeNominal.split(/\s*(?:x|×)\s*/i)[0] ?? "")
      : sizeNominal;

  if (
    parsedSizeNominal === null ||
    parsedSizeNominal === undefined ||
    Number.isNaN(parsedSizeNominal)
  ) {
    return null;
  }

  // Find existing size
  const [existingSize] = await db
    .select()
    .from(sizes)
    .where(
      and(
        eq(sizes.organizationId, organizationId),
        eq(sizes.nominal, parsedSizeNominal.toString()),
        eq(sizes.unitId, sizeUnitId),
      ),
    )
    .limit(1);

  if (existingSize) {
    return existingSize.id;
  }

  // Create new size
  const [newSize] = await db
    .insert(sizes)
    .values({
      organizationId,
      nominal: parsedSizeNominal.toString(),
      unitId: sizeUnitId,
    })
    .returning();

  return newSize?.id ?? null;
}

// Type for category (flat structure, no hierarchy)
type CategoryNode = {
  id: string;
  name: string;
  sortOrder: number;
  organizationId: string;
  partCount?: number;
};

type CatalogNode = {
  id: string;
  name: string;
  sortOrder: number;
  organizationId: string;
  partCount?: number;
};

export const catalogueRouter = createTRPCRouter({
  getCatalogs: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    if (!organizationId) {
      return [];
    }

    const allCatalogs = await ctx.db
      .select({
        id: catalogs.id,
        name: catalogs.name,
        sortOrder: catalogs.sortOrder,
        organizationId: catalogs.organizationId,
      })
      .from(catalogs)
      .where(eq(catalogs.organizationId, organizationId));

    const partCounts = await ctx.db
      .select({
        catalogId: partDefinitions.catalogId,
        count: sql<number>`count(*)::int`,
      })
      .from(partDefinitions)
      .where(
        and(
          eq(partDefinitions.isActive, true),
          eq(partDefinitions.organizationId, organizationId),
        ),
      )
      .groupBy(partDefinitions.catalogId);

    const countMap = new Map<string, number>();
    for (const pc of partCounts) {
      if (pc.catalogId) {
        countMap.set(pc.catalogId, pc.count);
      }
    }

    const catalogsWithCounts: CatalogNode[] = allCatalogs
      .map((catalog) => ({
        ...catalog,
        partCount: countMap.get(catalog.id) ?? 0,
      }))
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.name.localeCompare(b.name);
      });

    return catalogsWithCounts;
  }),

  createCatalog: hasDashboardAccess
    .input(z.object({ name: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;
      const trimmedName = input.name.trim();

      if (!organizationId) {
        throw new Error("User must belong to an organization");
      }

      const [existingCatalog] = await ctx.db
        .select()
        .from(catalogs)
        .where(
          and(
            eq(catalogs.organizationId, organizationId),
            sql`lower(${catalogs.name}) = lower(${trimmedName})`,
          ),
        )
        .limit(1);

      if (existingCatalog) {
        return existingCatalog;
      }

      const [maxSortOrder] = await ctx.db
        .select({
          maxSortOrder: sql<number>`coalesce(max(${catalogs.sortOrder}), -1)`,
        })
        .from(catalogs)
        .where(eq(catalogs.organizationId, organizationId));

      const [newCatalog] = await ctx.db
        .insert(catalogs)
        .values({
          organizationId,
          name: trimmedName,
          sortOrder: (maxSortOrder?.maxSortOrder ?? -1) + 1,
        })
        .returning();

      return newCatalog;
    }),
  /**
   * Get all categories for the user's organization (flat list, all are root categories)
   */
  getCategoryTree: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    if (!organizationId) {
      return [];
    }

    // Get all categories for the organization (all are root categories now)
    const allCategories = await ctx.db
      .select({
        id: categories.id,
        name: categories.name,
        sortOrder: categories.sortOrder,
        organizationId: categories.organizationId,
      })
      .from(categories)
      .where(eq(categories.organizationId, organizationId));

    // Get part counts for each category
    const partCounts = await ctx.db
      .select({
        categoryId: partDefinitions.categoryId,
        count: sql<number>`count(*)::int`,
      })
      .from(partDefinitions)
      .where(
        and(
          eq(partDefinitions.isActive, true),
          eq(partDefinitions.organizationId, organizationId),
        ),
      )
      .groupBy(partDefinitions.categoryId);

    const countMap = new Map<string, number>();
    for (const pc of partCounts) {
      if (pc.categoryId) {
        countMap.set(pc.categoryId, pc.count);
      }
    }

    // Add counts to categories and sort
    const categoriesWithCounts: CategoryNode[] = allCategories
      .map((cat) => ({
        ...cat,
        partCount: countMap.get(cat.id) ?? 0,
      }))
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.name.localeCompare(b.name);
      });

    return categoriesWithCounts;
  }),

  /**
   * Get parts for a specific category
   */
  getPartsByCategory: hasDashboardAccess
    .input(
      z.object({
        catalogId: z.string().uuid().optional(),
        categoryId: z.string().uuid().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;

      if (!organizationId) {
        return [];
      }

      // Build where conditions
      const conditions = [
        eq(partDefinitions.isActive, true),
        eq(partDefinitions.organizationId, organizationId),
      ];

      if (input.catalogId) {
        conditions.push(eq(partDefinitions.catalogId, input.catalogId));
      }

      // If categoryId is provided, filter by it; otherwise show all parts
      if (input.categoryId) {
        conditions.push(eq(partDefinitions.categoryId, input.categoryId));
      }
      // If categoryId is null, don't add any category filter (show all parts)

      // Get parts with joins
      const allParts = await ctx.db
        .select({
          id: partDefinitions.id,
          displayName: partDefinitions.displayName,
          imageUrl: partDefinitions.imageUrl,
          sizeLabel: partDefinitions.sizeLabel,
          materialId: partDefinitions.materialId,
          materialName: materials.name,
          sizeNominal: sizes.nominal,
          sizeUnitId: sizes.unitId,
          catalogId: partDefinitions.catalogId,
          categoryId: partDefinitions.categoryId,
          organizationId: partDefinitions.organizationId,
          sizeUnitCode: units.code,
        })
        .from(partDefinitions)
        .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
        .leftJoin(units, eq(sizes.unitId, units.id))
        .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
        .where(and(...conditions));

      // Sort: org-specific first, then global, then by name
      const parts = allParts.sort((a, b) => {
        const aIsOrg = a.organizationId === organizationId;
        const bIsOrg = b.organizationId === organizationId;
        if (aIsOrg !== bIsOrg) {
          return aIsOrg ? -1 : 1;
        }
        return a.displayName.localeCompare(b.displayName);
      });

      return parts.map((part) => ({
        id: part.id,
        displayName: part.displayName,
        imageUrl: part.imageUrl,
        material: part.materialName,
        size:
          part.sizeLabel ??
          (part.sizeNominal && part.sizeUnitCode
            ? formatSize(Number(part.sizeNominal), part.sizeUnitCode)
            : null),
        sizeLabel: part.sizeLabel,
        sizeNominal: part.sizeNominal,
        sizeUnit: part.sizeUnitCode,
        catalogId: part.catalogId,
        categoryId: part.categoryId,
        isOrgSpecific: part.organizationId === organizationId,
      }));
    }),

  /**
   * Faceted search with full filtering support
   * Supports: text search, category, category, material, size (normalized), and attributes
   */
  searchParts: hasDashboardAccess
    .input(
      z.object({
        // Text search (optional)
        query: z.string().optional(),
        catalogId: z.string().uuid().optional(),
        // Category filter (works with search or alone)
        categoryId: z.string().uuid().nullable().optional(),
        // Normalized filters
        materialId: z.string().uuid().optional(),
        // Size filtering (normalized)
        sizeNominal: z.number().optional(), // Primary normalized value (0.5 for 1/2)
        sizeUnit: z.string().optional(), // "in", "mm", etc.
        sizeTolerance: z.number().optional().default(0.01), // For range matching
        // Attribute filters (MVP: volume, flow_rate)
        attributeKey: z.string().optional(), // "volume", "flow_rate"
        attributeValueMin: z.number().optional(),
        attributeValueMax: z.number().optional(),
        attributeUnit: z.string().optional(),
        limit: z.number().int().positive().max(1000).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;

      if (!organizationId) {
        return [];
      }

      const conditions = [
        eq(partDefinitions.isActive, true),
        eq(partDefinitions.organizationId, organizationId),
      ];

      if (input.catalogId) {
        conditions.push(eq(partDefinitions.catalogId, input.catalogId));
      }

      // Category filter (direct category match, no subcategories)
      if (input.categoryId !== undefined && input.categoryId !== null) {
        conditions.push(eq(partDefinitions.categoryId, input.categoryId));
      }

      // Part type filter
      // Material filter
      if (input.materialId) {
        conditions.push(eq(partDefinitions.materialId, input.materialId));
      }

      // Size filter (normalized) - will be applied via join with sizes table
      let sizeMin: string | undefined;
      let sizeMax: string | undefined;
      let sizeUnitId: string | undefined;

      if (input.sizeNominal !== undefined) {
        const tolerance = input.sizeTolerance ?? 0.01;
        sizeMin = (input.sizeNominal - tolerance).toString();
        sizeMax = (input.sizeNominal + tolerance).toString();

        // If sizeUnit is specified, also filter by unit
        if (input.sizeUnit) {
          // Get unit ID for the specified unit code
          const [sizeUnitRow] = await ctx.db
            .select({ id: units.id })
            .from(units)
            .where(eq(units.code, input.sizeUnit))
            .limit(1);

          if (sizeUnitRow) {
            sizeUnitId = sizeUnitRow.id;
          }
        }
      }

      // Text search in displayName, description, or synonyms
      if (input.query && input.query.trim().length > 0) {
        const searchTerm = `%${input.query.trim()}%`;
        // Get part IDs that match synonyms
        const synonymMatches = await ctx.db
          .selectDistinct({ partDefinitionId: partSynonyms.partDefinitionId })
          .from(partSynonyms)
          .where(ilike(partSynonyms.synonym, searchTerm));

        const synonymPartIds = synonymMatches
          .map((m) => m.partDefinitionId)
          .filter((id): id is string => id !== null);

        if (synonymPartIds.length > 0) {
          const searchCondition = or(
            ilike(partDefinitions.displayName, searchTerm),
            ilike(partDefinitions.description, searchTerm),
            inArray(partDefinitions.id, synonymPartIds),
          );
          if (searchCondition) {
            conditions.push(searchCondition);
          }
        } else {
          const searchCondition = or(
            ilike(partDefinitions.displayName, searchTerm),
            ilike(partDefinitions.description, searchTerm),
          );
          if (searchCondition) {
            conditions.push(searchCondition);
          }
        }
      }

      // Attribute filtering (if specified)
      if (input.attributeKey) {
        // Get unit ID for attribute unit if specified
        let attributeUnitId: string | undefined;
        if (input.attributeUnit) {
          const [attrUnitRow] = await ctx.db
            .select({ id: units.id })
            .from(units)
            .where(eq(units.code, input.attributeUnit))
            .limit(1);
          if (attrUnitRow) {
            attributeUnitId = attrUnitRow.id;
          }
        }

        // Build attribute filter conditions
        const attrConditions = [
          eq(partAttributes.key, input.attributeKey),
          isNotNull(partAttributes.valueNum),
        ];

        if (input.attributeValueMin !== undefined) {
          attrConditions.push(
            gte(partAttributes.valueNum, input.attributeValueMin.toString()),
          );
        }
        if (input.attributeValueMax !== undefined) {
          attrConditions.push(
            lte(partAttributes.valueNum, input.attributeValueMax.toString()),
          );
        }
        if (attributeUnitId) {
          attrConditions.push(eq(partAttributes.unitId, attributeUnitId));
        }

        // Get part IDs that match attribute filters
        const matchingPartIds = await ctx.db
          .selectDistinct({ partDefinitionId: partAttributes.partDefinitionId })
          .from(partAttributes)
          .where(and(...attrConditions));

        const partIds = matchingPartIds
          .map((m) => m.partDefinitionId)
          .filter((id): id is string => id !== null);

        if (partIds.length > 0) {
          conditions.push(inArray(partDefinitions.id, partIds));
        } else {
          // No parts match attribute filter, return empty
          return [];
        }
      }

      // Build size filter conditions for join
      const sizeJoinConditions: Array<
        ReturnType<typeof gte> | ReturnType<typeof lte> | ReturnType<typeof eq>
      > = [];
      if (sizeMin !== undefined) {
        sizeJoinConditions.push(gte(sizes.nominal, sizeMin));
      }
      if (sizeMax !== undefined) {
        sizeJoinConditions.push(lte(sizes.nominal, sizeMax));
      }
      if (sizeUnitId !== undefined) {
        sizeJoinConditions.push(eq(sizes.unitId, sizeUnitId));
      }

      // Build and execute query
      // Use leftJoin for sizes to handle cases where sizeId might be invalid (orphaned foreign keys)
      // This prevents query failures while we ensure data integrity
      const allParts = await ctx.db
        .select({
          id: partDefinitions.id,
          displayName: partDefinitions.displayName,
          description: partDefinitions.description,
          imageUrl: partDefinitions.imageUrl,
          sizeLabel: partDefinitions.sizeLabel,
          materialId: partDefinitions.materialId,
          materialName: materials.name,
          sizeNominal: sizes.nominal,
          sizeUnitId: sizes.unitId,
          catalogId: partDefinitions.catalogId,
          categoryId: partDefinitions.categoryId,
          organizationId: partDefinitions.organizationId,
          sizeUnitCode: units.code,
        })
        .from(partDefinitions)
        .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
        .leftJoin(units, eq(sizes.unitId, units.id))
        .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
        .where(
          and(
            ...conditions,
            ...(sizeJoinConditions.length > 0 ? sizeJoinConditions : []),
          ),
        )
        .limit(input.limit ?? 5000);

      // Sort: org-specific first, then global, then by name
      const parts = allParts.sort((a, b) => {
        const aIsOrg = a.organizationId === organizationId;
        const bIsOrg = b.organizationId === organizationId;
        if (aIsOrg !== bIsOrg) {
          return aIsOrg ? -1 : 1;
        }
        return a.displayName.localeCompare(b.displayName);
      });

      return parts.map((part) => ({
        id: part.id,
        displayName: part.displayName,
        description: part.description,
        imageUrl: part.imageUrl,
        material: part.materialName,
        materialId: part.materialId,
        size:
          part.sizeLabel ??
          (part.sizeNominal && part.sizeUnitCode
            ? formatSize(Number(part.sizeNominal), part.sizeUnitCode)
            : null),
        sizeLabel: part.sizeLabel,
        sizeNominal: part.sizeNominal,
        sizeUnit: part.sizeUnitCode,
        catalogId: part.catalogId,
        categoryId: part.categoryId,
        isOrgSpecific: part.organizationId === organizationId,
      }));
    }),

  /**
   * Get distinct materials for filter dropdown
   * Combines materials from materials table (both org-specific and global)
   * Returns materials with id and name
   */
  getMaterials: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    if (!organizationId) {
      return [];
    }

    // Get materials from materials table (org-specific)
    const allMaterials = await ctx.db
      .select({
        id: materials.id,
        name: materials.name,
      })
      .from(materials)
      .where(eq(materials.organizationId, organizationId))
      .orderBy(materials.name);

    // Also get materials from active part definitions (via join)
    const partDefMaterials = await ctx.db
      .selectDistinct({
        materialId: materials.id,
        materialName: materials.name,
      })
      .from(partDefinitions)
      .innerJoin(materials, eq(partDefinitions.materialId, materials.id))
      .where(
        and(
          eq(partDefinitions.isActive, true),
          isNotNull(partDefinitions.materialId),
          eq(partDefinitions.organizationId, organizationId),
        ),
      )
      .orderBy(materials.name);

    // Combine and deduplicate by ID
    const materialMap = new Map<string, { id: string; name: string }>();
    for (const m of allMaterials) {
      materialMap.set(m.id, { id: m.id, name: m.name });
    }
    for (const m of partDefMaterials) {
      if (m.materialId && m.materialName) {
        materialMap.set(m.materialId, {
          id: m.materialId,
          name: m.materialName,
        });
      }
    }

    return Array.from(materialMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }),

  /**
   * Create a custom material
   */
  createMaterial: hasDashboardAccess
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;
      const trimmedName = input.name.trim();

      if (!organizationId) {
        throw new Error("User must belong to an organization");
      }

      const [existingMaterial] = await ctx.db
        .select()
        .from(materials)
        .where(
          and(
            eq(materials.organizationId, organizationId),
            sql`lower(${materials.name}) = lower(${trimmedName})`,
          ),
        )
        .limit(1);

      if (existingMaterial) {
        return existingMaterial;
      }

      const [newMaterial] = await ctx.db
        .insert(materials)
        .values({
          organizationId: organizationId,
          name: trimmedName,
        })
        .returning();

      return newMaterial;
    }),

  /**
   * Get distinct part type categories (top-level: Fittings, Valves, Pipes, etc.)
   * Derived from parent categories of parts
   * Can optionally filter by material and size
   */
  getCategories: hasDashboardAccess
    .input(
      z
        .object({
          catalogId: z.string().uuid().optional(),
          materialId: z.string().uuid().optional(),
          sizeNominal: z.number().optional(),
          sizeUnit: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;
      if (!organizationId) {
        return [];
      }

      // Get all categories (all are root categories now)
      const allCategories = await ctx.db
        .select({
          id: categories.id,
          name: categories.name,
          sortOrder: categories.sortOrder,
          organizationId: categories.organizationId,
        })
        .from(categories)
        .where(eq(categories.organizationId, organizationId));

      // Build base conditions for counting parts
      const baseConditions = [
        eq(partDefinitions.isActive, true),
        eq(partDefinitions.organizationId, organizationId),
      ];

      if (input?.catalogId) {
        baseConditions.push(eq(partDefinitions.catalogId, input.catalogId));
      }

      // Add material filter if provided
      if (input?.materialId) {
        baseConditions.push(eq(partDefinitions.materialId, input.materialId));
      }

      // Add size filter if provided (need to join with sizes table)
      let sizeJoinNeeded = false;
      if (input?.sizeNominal !== undefined) {
        sizeJoinNeeded = true;
      }

      // Get unit ID for size unit if provided
      let sizeUnitId: string | undefined;
      if (input?.sizeUnit) {
        const [unitRow] = await ctx.db
          .select({ id: units.id })
          .from(units)
          .where(eq(units.code, input.sizeUnit))
          .limit(1);
        sizeUnitId = unitRow?.id;
      }

      const sizeConditions = [];
      if (sizeJoinNeeded && input?.sizeNominal !== undefined) {
        const tolerance = 0.01;
        sizeConditions.push(
          gte(sizes.nominal, (input.sizeNominal - tolerance).toString()),
          lte(sizes.nominal, (input.sizeNominal + tolerance).toString()),
        );

        if (sizeUnitId) {
          sizeConditions.push(eq(sizes.unitId, sizeUnitId));
        }
      }

      const countRows = sizeConditions.length
        ? await ctx.db
            .select({
              categoryId: partDefinitions.categoryId,
              count: sql<number>`count(*)`,
            })
            .from(partDefinitions)
            .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
            .where(
              and(
                ...baseConditions,
                ...sizeConditions,
                isNotNull(partDefinitions.categoryId),
              ),
            )
            .groupBy(partDefinitions.categoryId)
        : await ctx.db
            .select({
              categoryId: partDefinitions.categoryId,
              count: sql<number>`count(*)`,
            })
            .from(partDefinitions)
            .where(
              and(...baseConditions, isNotNull(partDefinitions.categoryId)),
            )
            .groupBy(partDefinitions.categoryId);

      const countByCategoryId = new Map(
        countRows.map((row) => [row.categoryId, Number(row.count ?? 0)]),
      );

      return allCategories
        .map((category) => ({
          categoryId: category.id,
          name: category.name,
          count: countByCategoryId.get(category.id) ?? 0,
        }))
        .filter((category) => category.count > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    }),

  /**
   * Create a custom size
   */
  createSize: hasDashboardAccess
    .input(
      z.object({
        nominal: z.number(),
        unitId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;

      if (!organizationId) {
        throw new Error("User must belong to an organization");
      }

      const [newSize] = await ctx.db
        .insert(sizes)
        .values({
          organizationId: organizationId,
          nominal: input.nominal.toString(),
          unitId: input.unitId,
        })
        .returning();

      return newSize;
    }),

  createCategoryType: hasDashboardAccess
    .input(
      z.object({
        name: z.string().min(1).max(100),
        parentId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;
      const trimmedName = input.name.trim();

      if (!organizationId) {
        throw new Error("User must belong to an organization");
      }

      const [existingCategory] = await ctx.db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.organizationId, organizationId),
            sql`lower(${categories.name}) = lower(${trimmedName})`,
          ),
        )
        .limit(1);

      if (existingCategory) {
        return existingCategory;
      }

      const [newCategory] = await ctx.db
        .insert(categories)
        .values({
          organizationId: organizationId,
          name: trimmedName,
          parentId: input.parentId ?? null,
          sortOrder: 0,
        })
        .returning();

      return newCategory;
    }),

  /**
   * Get all units
   */
  getAllUnits: hasDashboardAccess.query(async ({ ctx }) => {
    const allUnits = await ctx.db
      .select({
        id: units.id,
        code: units.code,
        displayName: units.displayName,
        kind: units.kind,
      })
      .from(units)
      .orderBy(units.code);

    return allUnits;
  }),

  /**
   * Get available sizes (combines sizes table and part definitions)
   * Used for size selection in the wizard
   */
  getAvailableSizes: hasDashboardAccess
    .input(
      z.object({
        catalogId: z.string().uuid().optional(),
        materialId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;

      if (!organizationId) {
        return [];
      }

      // Get unique size combinations directly from part definitions that match the material
      // This ensures we only show sizes that actually have parts for the selected material
      const sizeConditions = [
        eq(partDefinitions.isActive, true),
        eq(partDefinitions.organizationId, organizationId),
      ];

      if (input.catalogId) {
        sizeConditions.push(eq(partDefinitions.catalogId, input.catalogId));
      }

      if (input.materialId) {
        sizeConditions.push(eq(partDefinitions.materialId, input.materialId));
      }

      const sizeRows = await ctx.db
        .select({
          nominal: sizes.nominal,
          unitId: sizes.unitId,
          unitCode: units.code,
          count: sql<number>`count(*)::int`,
        })
        .from(partDefinitions)
        .innerJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
        .innerJoin(units, eq(sizes.unitId, units.id))
        .where(and(...sizeConditions, isNotNull(partDefinitions.sizeId)))
        .groupBy(sizes.nominal, sizes.unitId, units.code);

      return sizeRows.map((size) => ({
        nominal: parseFloat(size.nominal ?? "0") ?? 0,
        unitId: size.unitId ?? "",
        unit: size.unitCode ?? "",
        count: size.count ?? 0,
      }));
    }),

  /**
   * Get available size units for filter dropdown
   */
  getSizeUnits: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    if (!organizationId) {
      return [];
    }

    // Get units that are used as size units in part definitions
    const sizeUnits = await ctx.db
      .selectDistinct({
        unitCode: units.code,
        unitDisplayName: units.displayName,
      })
      .from(partDefinitions)
      .innerJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
      .innerJoin(units, eq(sizes.unitId, units.id))
      .where(
        and(
          eq(partDefinitions.isActive, true),
          eq(partDefinitions.organizationId, organizationId),
        ),
      )
      .orderBy(units.code);

    return sizeUnits.map((u) => ({
      code: u.unitCode,
      displayName: u.unitDisplayName ?? u.unitCode,
    }));
  }),

  /**
   * Get available attribute keys for filter dropdown (MVP: volume, flow_rate)
   */
  getAttributeKeys: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    if (!organizationId) {
      return [];
    }

    // Get part IDs that user has access to
    const accessiblePartIds = await ctx.db
      .select({ id: partDefinitions.id })
      .from(partDefinitions)
      .where(
        and(
          eq(partDefinitions.isActive, true),
          eq(partDefinitions.organizationId, organizationId),
        ),
      );

    const partIdList = accessiblePartIds.map((p) => p.id);

    if (partIdList.length === 0) {
      return [];
    }

    // Get distinct attribute keys from accessible parts
    const attributeKeys = await ctx.db
      .selectDistinct({
        key: partAttributes.key,
      })
      .from(partAttributes)
      .where(inArray(partAttributes.partDefinitionId, partIdList))
      .orderBy(partAttributes.key);

    return attributeKeys.map((ak) => ak.key);
  }),

  /**
   * Get a single part by ID with full details
   */
  getPart: hasDashboardAccess
    .input(z.object({ partId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;

      const [part] = await ctx.db
        .select({
          id: partDefinitions.id,
          displayName: partDefinitions.displayName,
          description: partDefinitions.description,
          imageUrl: partDefinitions.imageUrl,
          sizeLabel: partDefinitions.sizeLabel,
          catalogId: partDefinitions.catalogId,
          categoryId: partDefinitions.categoryId,
          materialId: partDefinitions.materialId,
          materialName: materials.name,
          sizeNominal: sizes.nominal,
          sizeUnitId: sizes.unitId,
          isActive: partDefinitions.isActive,
          organizationId: partDefinitions.organizationId,
          sizeUnitCode: units.code,
          sizeUnitDisplayName: units.displayName,
        })
        .from(partDefinitions)
        .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
        .leftJoin(units, eq(sizes.unitId, units.id))
        .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
        .where(
          and(
            eq(partDefinitions.id, input.partId),
            organizationId
              ? eq(partDefinitions.organizationId, organizationId)
              : sql`1=0`, // Return no results if no organizationId
          ),
        )
        .limit(1);

      if (!part) {
        throw new Error("Part not found");
      }

      const aliases = await ctx.db
        .select({ id: partSynonyms.id, synonym: partSynonyms.synonym })
        .from(partSynonyms)
        .where(eq(partSynonyms.partDefinitionId, input.partId))
        .orderBy(partSynonyms.synonym);

      return {
        id: part.id,
        displayName: part.displayName,
        description: part.description,
        imageUrl: part.imageUrl,
        catalogId: part.catalogId,
        categoryId: part.categoryId,
        material: part.materialName,
        sizeNominal: part.sizeNominal,
        sizeLabel: part.sizeLabel,
        sizeUnitId: part.sizeUnitId,
        isActive: part.isActive,
        isOrgSpecific: part.organizationId === organizationId,
        sizeUnit: part.sizeUnitId
          ? {
              id: part.sizeUnitId,
              code: part.sizeUnitCode,
              displayName: part.sizeUnitDisplayName,
            }
          : null,
        aliases,
      };
    }),

  /**
   * Update a part definition
   */
  updatePart: hasDashboardAccess
    .input(
      z.object({
        partId: z.string().uuid(),
        displayName: z.string().min(1).max(255).optional(),
        description: z.string().optional().nullable(),
        imageUrl: z.string().optional().nullable(),
        catalogId: z.string().uuid().optional(),
        categoryId: z.string().uuid().optional().nullable(),
        materialId: z.string().uuid().optional().nullable(),
        sizeNominal: z.number().optional().nullable(),
        sizeLabel: z.string().optional().nullable(),
        sizeUnitId: z.string().uuid().optional().nullable(),
        isActive: z.boolean().optional(),
        aliases: z.array(z.string().min(1).max(255)).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;

      // Verify part exists and user has access
      const [existing] = await ctx.db
        .select({
          id: partDefinitions.id,
          organizationId: partDefinitions.organizationId,
        })
        .from(partDefinitions)
        .where(
          and(
            eq(partDefinitions.id, input.partId),
            organizationId
              ? eq(partDefinitions.organizationId, organizationId)
              : undefined,
          ),
        )
        .limit(1);

      if (!existing) {
        throw new Error("Part not found or access denied");
      }

      // Only allow editing org-specific parts or creating org-specific copies of global parts
      const isGlobal = !existing.organizationId;
      const isOrgSpecific = existing.organizationId === organizationId;

      // Handle size: find/create size records, or clear size when the client
      // explicitly sends nulls. Undefined means "leave existing value alone".
      let sizeId: string | null = null;
      const sizeTouched =
        input.sizeNominal !== undefined || input.sizeUnitId !== undefined;
      if (sizeTouched) {
        // Get current part to use existing size if new values not provided
        const [currentPart] = await ctx.db
          .select()
          .from(partDefinitions)
          .where(eq(partDefinitions.id, input.partId))
          .limit(1);

        if (currentPart) {
          // Get current size to extract nominal/unitId if not provided
          const [currentSize] = currentPart.sizeId
            ? await ctx.db
                .select()
                .from(sizes)
                .where(eq(sizes.id, currentPart.sizeId))
                .limit(1)
            : [null];

          const finalSizeNominal =
            input.sizeNominal !== undefined
              ? input.sizeNominal
              : currentSize
                ? parseFloat(currentSize.nominal)
                : null;
          const finalSizeUnitId =
            input.sizeUnitId !== undefined
              ? input.sizeUnitId
              : currentSize?.unitId ?? null;

          sizeId = await findOrCreateSize(
            ctx.db,
            organizationId ?? existing.organizationId,
            finalSizeNominal,
            finalSizeUnitId,
          );
        }
      }

      // If trying to edit a global part, create an org-specific copy
      if (isGlobal && organizationId) {
        // Get the original part with all details
        const [originalPart] = await ctx.db
          .select()
          .from(partDefinitions)
          .where(eq(partDefinitions.id, input.partId))
          .limit(1);

        if (!originalPart) {
          throw new Error("Part not found");
        }

        // Use provided sizeId, including explicit null to clear it, or keep original
        // when size fields were not part of the edit payload.
        const finalSizeId = sizeTouched ? sizeId : originalPart.sizeId;

        // Create org-specific copy
        const [newPart] = await ctx.db
          .insert(partDefinitions)
          .values({
            organizationId: organizationId,
            catalogId: input.catalogId ?? originalPart.catalogId,
            categoryId:
              input.categoryId !== undefined
                ? input.categoryId
                : originalPart.categoryId,
            displayName: input.displayName ?? originalPart.displayName,
            description:
              input.description !== undefined
                ? input.description
                : originalPart.description,
            imageUrl:
              input.imageUrl !== undefined ? input.imageUrl : originalPart.imageUrl,
            sizeLabel:
              input.sizeLabel !== undefined
                ? input.sizeLabel?.trim() || null
                : originalPart.sizeLabel,
            materialId:
              input.materialId !== undefined
                ? input.materialId
                : originalPart.materialId,
            sizeId: finalSizeId,
            isActive: input.isActive ?? originalPart.isActive,
          })
          .returning();

        return newPart;
      }

      // Update existing part
      const updateData: Partial<typeof partDefinitions.$inferInsert> = {};
      if (input.displayName !== undefined)
        updateData.displayName = input.displayName;
      if (input.description !== undefined)
        updateData.description = input.description;
      if (input.imageUrl !== undefined) updateData.imageUrl = input.imageUrl;
      if (input.sizeLabel !== undefined)
        updateData.sizeLabel = input.sizeLabel?.trim() || null;
      if (input.catalogId !== undefined) updateData.catalogId = input.catalogId;
      if (input.categoryId !== undefined)
        updateData.categoryId = input.categoryId;
      if (input.materialId !== undefined)
        updateData.materialId = input.materialId;
      if (sizeTouched) updateData.sizeId = sizeId;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      const [updated] = await ctx.db
        .update(partDefinitions)
        .set(updateData)
        .where(eq(partDefinitions.id, input.partId))
        .returning();

      if (!updated) {
        throw new Error("Failed to update part");
      }

      if (input.aliases !== undefined) {
        await syncPartAliases(ctx.db, updated.id, input.aliases);
      }

      return updated;
    }),

  findDuplicateCandidates: hasDashboardAccess
    .input(
      z.object({
        partId: z.string().uuid(),
        limit: z.number().min(1).max(20).default(8),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;
      if (!organizationId) return [];

      const [part] = await ctx.db
        .select({
          id: partDefinitions.id,
          displayName: partDefinitions.displayName,
          catalogId: partDefinitions.catalogId,
          categoryId: partDefinitions.categoryId,
          materialId: partDefinitions.materialId,
          sizeId: partDefinitions.sizeId,
        })
        .from(partDefinitions)
        .where(
          and(
            eq(partDefinitions.id, input.partId),
            eq(partDefinitions.organizationId, organizationId),
          ),
        )
        .limit(1);

      if (!part) return [];

      const exactName = part.displayName.trim().toLowerCase();
      const looseName = `%${part.displayName.trim().replace(/\s+/g, "%")}%`;

      const candidates = await ctx.db
        .select({
          id: partDefinitions.id,
          displayName: partDefinitions.displayName,
          description: partDefinitions.description,
          imageUrl: partDefinitions.imageUrl,
          sizeLabel: partDefinitions.sizeLabel,
          materialName: materials.name,
          sizeNominal: sizes.nominal,
          sizeUnitCode: units.code,
          catalogId: partDefinitions.catalogId,
          categoryId: partDefinitions.categoryId,
          materialId: partDefinitions.materialId,
          sizeId: partDefinitions.sizeId,
        })
        .from(partDefinitions)
        .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
        .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
        .leftJoin(units, eq(sizes.unitId, units.id))
        .where(
          and(
            eq(partDefinitions.organizationId, organizationId),
            eq(partDefinitions.isActive, true),
            sql`${partDefinitions.id} <> ${input.partId}`,
            or(
              sql`lower(${partDefinitions.displayName}) = ${exactName}`,
              and(
                eq(partDefinitions.catalogId, part.catalogId),
                part.categoryId
                  ? eq(partDefinitions.categoryId, part.categoryId)
                  : isNull(partDefinitions.categoryId),
                part.materialId
                  ? eq(partDefinitions.materialId, part.materialId)
                  : isNull(partDefinitions.materialId),
                part.sizeId
                  ? eq(partDefinitions.sizeId, part.sizeId)
                  : isNull(partDefinitions.sizeId),
              ),
              ilike(partDefinitions.displayName, looseName),
            ),
          ),
        )
        .limit(input.limit);

      return candidates.map((candidate) => ({
        id: candidate.id,
        displayName: candidate.displayName,
        description: candidate.description,
        imageUrl: candidate.imageUrl,
        material: candidate.materialName,
        size:
          candidate.sizeLabel ??
          (candidate.sizeNominal && candidate.sizeUnitCode
            ? formatSize(Number(candidate.sizeNominal), candidate.sizeUnitCode)
            : null),
        sizeLabel: candidate.sizeLabel,
        reasons: [
          candidate.displayName.trim().toLowerCase() === exactName
            ? "same name"
            : null,
          candidate.catalogId === part.catalogId &&
          candidate.categoryId === part.categoryId
            ? "same category"
            : null,
          candidate.materialId === part.materialId ? "same material" : null,
          candidate.sizeId === part.sizeId ? "same size" : null,
        ].filter((reason): reason is string => !!reason),
      }));
    }),

  mergeDuplicatePart: hasDashboardAccess
    .input(
      z.object({
        sourcePartId: z.string().uuid(),
        targetPartId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanDeleteCoreRecords(ctx.user);

      const organizationId = ctx.user.organizationId;
      if (!organizationId) {
        throw new Error("User must belong to an organization");
      }

      if (input.sourcePartId === input.targetPartId) {
        throw new Error("Choose two different parts to merge");
      }

      const parts = await ctx.db
        .select({
          id: partDefinitions.id,
          displayName: partDefinitions.displayName,
        })
        .from(partDefinitions)
        .where(
          and(
            eq(partDefinitions.organizationId, organizationId),
            inArray(partDefinitions.id, [
              input.sourcePartId,
              input.targetPartId,
            ]),
          ),
        );

      const source = parts.find((part) => part.id === input.sourcePartId);
      const target = parts.find((part) => part.id === input.targetPartId);
      if (!source || !target) {
        throw new Error("Both parts must exist in your organization");
      }

      await ctx.db
        .update(quoteItems)
        .set({ partDefinitionId: input.targetPartId })
        .where(eq(quoteItems.partDefinitionId, input.sourcePartId));

      await ctx.db
        .update(orderItems)
        .set({ partDefinitionId: input.targetPartId })
        .where(eq(orderItems.partDefinitionId, input.sourcePartId));

      await ctx.db
        .update(supplierParts)
        .set({ partDefinitionId: input.targetPartId })
        .where(eq(supplierParts.partDefinitionId, input.sourcePartId));

      const sourceAliases = await ctx.db
        .select({ synonym: partSynonyms.synonym })
        .from(partSynonyms)
        .where(eq(partSynonyms.partDefinitionId, input.sourcePartId));

      const targetAliases = await ctx.db
        .select({ synonym: partSynonyms.synonym })
        .from(partSynonyms)
        .where(eq(partSynonyms.partDefinitionId, input.targetPartId));

      const existingAliasSet = new Set(
        targetAliases.map((alias) => alias.synonym.trim().toLowerCase()),
      );
      const mergedAliases = [
        source.displayName,
        ...sourceAliases.map((alias) => alias.synonym),
      ]
        .map((alias) => alias.trim())
        .filter((alias) => alias && !existingAliasSet.has(alias.toLowerCase()))
        .map((synonym) => ({ partDefinitionId: input.targetPartId, synonym }));

      if (mergedAliases.length > 0) {
        await ctx.db.insert(partSynonyms).values(mergedAliases);
      }

      await ctx.db
        .update(partDefinitions)
        .set({ isActive: false })
        .where(eq(partDefinitions.id, input.sourcePartId));

      return {
        mergedPartId: input.sourcePartId,
        targetPartId: input.targetPartId,
      };
    }),

  /**
   * Get preferred suppliers and available suppliers for multiple parts (batch query)
   * Used by catalogue page to display supplier information efficiently
   */
  getPartsSupplierInfo: hasDashboardAccess
    .input(
      z.object({
        partIds: z.array(z.string().uuid()),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        return {};
      }

      if (input.partIds.length === 0) {
        return {};
      }

      // Get preferred suppliers for the specified parts
      const preferredSuppliers = await ctx.db
        .select({
          supplierPart: supplierParts,
          supplier: suppliers,
          partDefinitionId: supplierParts.partDefinitionId,
        })
        .from(supplierParts)
        .innerJoin(suppliers, eq(supplierParts.supplierId, suppliers.id))
        .where(
          and(
            inArray(supplierParts.partDefinitionId, input.partIds),
            eq(supplierParts.isPreferred, true),
            eq(supplierParts.organizationId, ctx.user.organizationId),
          ),
        );

      // Create a map of partDefinitionId -> preferred supplier
      const preferredMap = new Map(
        preferredSuppliers.map((ps) => [ps.partDefinitionId, ps.supplier]),
      );

      // Get all suppliers for the specified parts
      const allSupplierParts = await ctx.db
        .select({
          supplierPart: supplierParts,
          supplier: suppliers,
          partDefinitionId: supplierParts.partDefinitionId,
        })
        .from(supplierParts)
        .innerJoin(suppliers, eq(supplierParts.supplierId, suppliers.id))
        .where(
          and(
            inArray(supplierParts.partDefinitionId, input.partIds),
            eq(supplierParts.organizationId, ctx.user.organizationId),
          ),
        );

      // Group suppliers by part
      const suppliersByPart = new Map<
        string,
        (typeof suppliers.$inferSelect)[]
      >();
      for (const sp of allSupplierParts) {
        const existing = suppliersByPart.get(sp.partDefinitionId) ?? [];
        existing.push(sp.supplier);
        suppliersByPart.set(sp.partDefinitionId, existing);
      }

      // Build result map
      const result: Record<
        string,
        {
          preferredSupplier: typeof suppliers.$inferSelect | null;
          availableSuppliers: (typeof suppliers.$inferSelect)[];
        }
      > = {};

      for (const partId of input.partIds) {
        result[partId] = {
          preferredSupplier: preferredMap.get(partId) ?? null,
          availableSuppliers: suppliersByPart.get(partId) ?? [],
        };
      }

      return result;
    }),

  /**
   * Get or create "Other" category for the organization
   */
  getOrCreateOtherCategory: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    if (!organizationId) {
      throw new Error("User must belong to an organization");
    }

    // Check if "Other" category exists for this organization
    const [existing] = await ctx.db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.name, "Other"),
          eq(categories.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (existing) {
      return existing.id;
    }

    // Create "Other" category
    const [newCategory] = await ctx.db
      .insert(categories)
      .values({
        name: "Other",
        organizationId: organizationId,
        sortOrder: 9999, // Put it at the end
      })
      .returning();

    return newCategory.id;
  }),

  exportCatalogueRows: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    if (!organizationId) {
      throw new Error("User must belong to an organization");
    }

    const rows = await ctx.db
      .select({
        partId: partDefinitions.id,
        catalogName: catalogs.name,
        categoryName: categories.name,
        materialName: materials.name,
        displayName: partDefinitions.displayName,
        description: partDefinitions.description,
        sizeNominal: sizes.nominal,
        sizeLabel: partDefinitions.sizeLabel,
        sizeUnitCode: units.code,
        imageUrl: partDefinitions.imageUrl,
        isActive: partDefinitions.isActive,
      })
      .from(partDefinitions)
      .innerJoin(catalogs, eq(partDefinitions.catalogId, catalogs.id))
      .leftJoin(categories, eq(partDefinitions.categoryId, categories.id))
      .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
      .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
      .leftJoin(units, eq(sizes.unitId, units.id))
      .where(eq(partDefinitions.organizationId, organizationId))
      .orderBy(
        catalogs.sortOrder,
        categories.sortOrder,
        partDefinitions.displayName,
      );

    const aliases = rows.length
      ? await ctx.db
          .select({
            partDefinitionId: partSynonyms.partDefinitionId,
            synonym: partSynonyms.synonym,
          })
          .from(partSynonyms)
          .where(
            inArray(
              partSynonyms.partDefinitionId,
              rows.map((row) => row.partId),
            ),
          )
      : [];

    const aliasesByPartId = new Map<string, string[]>();
    for (const alias of aliases) {
      aliasesByPartId.set(alias.partDefinitionId, [
        ...(aliasesByPartId.get(alias.partDefinitionId) ?? []),
        alias.synonym,
      ]);
    }

    return rows.map((row) => ({
      partId: row.partId,
      catalog: row.catalogName,
      category: row.categoryName ?? "",
      material: row.materialName ?? "",
      displayName: row.displayName,
      description: row.description ?? "",
      sizeNominal:
        row.sizeLabel ??
        (row.sizeNominal !== null && row.sizeNominal !== undefined
          ? Number(row.sizeNominal)
          : null),
      sizeUnit: row.sizeUnitCode ?? "",
      imageUrl: row.imageUrl ?? "",
      aliases: (aliasesByPartId.get(row.partId) ?? []).join("; "),
      isActive: row.isActive,
    }));
  }),

  importCatalogueRows: hasDashboardAccess
    .input(
      z.object({
        rows: z.array(
          z.object({
            partId: z.string().uuid().optional().nullable(),
            catalog: z.string(),
            category: z.string().optional().nullable(),
            material: z.string().optional().nullable(),
            displayName: z.string().optional().default(""),
            description: z.string().optional().nullable(),
            sizeNominal: z
              .union([z.number(), z.string()])
              .optional()
              .nullable(),
            sizeUnit: z.string().optional().nullable(),
            imageUrl: z.string().optional().nullable(),
            aliases: z.string().optional().nullable(),
            isActive: z.boolean().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;

      if (!organizationId) {
        throw new Error("User must belong to an organization");
      }

      const [
        existingCatalogs,
        existingCategories,
        existingMaterials,
        allUnits,
        existingParts,
      ] = await Promise.all([
        ctx.db
          .select()
          .from(catalogs)
          .where(eq(catalogs.organizationId, organizationId)),
        ctx.db
          .select()
          .from(categories)
          .where(eq(categories.organizationId, organizationId)),
        ctx.db
          .select()
          .from(materials)
          .where(eq(materials.organizationId, organizationId)),
        ctx.db.select().from(units),
        ctx.db
          .select({
            id: partDefinitions.id,
            organizationId: partDefinitions.organizationId,
          })
          .from(partDefinitions)
          .where(eq(partDefinitions.organizationId, organizationId)),
      ]);

      const catalogByName = new Map(
        existingCatalogs.map((item) => [item.name.trim().toLowerCase(), item]),
      );
      const categoryByName = new Map(
        existingCategories.map((item) => [
          item.name.trim().toLowerCase(),
          item,
        ]),
      );
      const materialByName = new Map(
        existingMaterials.map((item) => [item.name.trim().toLowerCase(), item]),
      );
      const unitByCode = new Map(
        allUnits.map((item) => [item.code.trim().toLowerCase(), item]),
      );
      const existingPartIds = new Set(existingParts.map((item) => item.id));

      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const rawRow of input.rows) {
        const displayName =
          rawRow.displayName.trim() ||
          generatePartDisplayName({
            sizeNominal: rawRow.sizeNominal,
            sizeUnit: rawRow.sizeUnit,
            material: rawRow.material,
            description: rawRow.description,
          });
        const catalogName = rawRow.catalog.trim();

        if (!displayName || !catalogName) {
          skipped += 1;
          continue;
        }

        const catalogKey = catalogName.toLowerCase();
        let catalog = catalogByName.get(catalogKey);
        if (!catalog) {
          const [maxSortOrder] = await ctx.db
            .select({
              maxSortOrder: sql<number>`coalesce(max(${catalogs.sortOrder}), -1)`,
            })
            .from(catalogs)
            .where(eq(catalogs.organizationId, organizationId));

          const [newCatalog] = await ctx.db
            .insert(catalogs)
            .values({
              organizationId,
              name: catalogName,
              sortOrder: (maxSortOrder?.maxSortOrder ?? -1) + 1,
            })
            .returning();

          if (!newCatalog) {
            skipped += 1;
            continue;
          }

          catalog = newCatalog;
          catalogByName.set(catalogKey, newCatalog);
        }

        const categoryName = rawRow.category?.trim() || "";
        let categoryId: string | null = null;
        if (categoryName) {
          const categoryKey = categoryName.toLowerCase();
          let category = categoryByName.get(categoryKey) ?? null;
          if (!category) {
            const [newCategory] = await ctx.db
              .insert(categories)
              .values({
                organizationId,
                name: categoryName,
                sortOrder: 0,
              })
              .returning();
            if (!newCategory) {
              skipped += 1;
              continue;
            }
            category = newCategory;
            categoryByName.set(categoryKey, newCategory);
          }
          categoryId = category?.id ?? null;
        }

        let materialId: string | null = null;
        const materialName = rawRow.material?.trim();
        if (materialName) {
          const materialKey = materialName.toLowerCase();
          let material = materialByName.get(materialKey);
          if (!material) {
            const [newMaterial] = await ctx.db
              .insert(materials)
              .values({ organizationId, name: materialName })
              .returning();
            material = newMaterial;
            if (material) {
              materialByName.set(materialKey, material);
            }
          }
          materialId = material?.id ?? null;
        }

        const sizeUnitCode = rawRow.sizeUnit?.trim().toLowerCase() || "";
        const sizeUnitId = sizeUnitCode
          ? (unitByCode.get(sizeUnitCode)?.id ?? null)
          : null;
        const sizeLabel =
          formatSizeDimensions(
            rawRow.sizeNominal ?? null,
            rawRow.sizeUnit ?? null,
          ) || null;
        const sizeId = await findOrCreateSize(
          ctx.db,
          organizationId,
          rawRow.sizeNominal ?? null,
          sizeUnitId,
        );

        const values: typeof partDefinitions.$inferInsert = {
          organizationId,
          catalogId: catalog.id,
          categoryId,
          displayName,
          description: rawRow.description?.trim() || null,
          imageUrl: rawRow.imageUrl?.trim() || null,
          sizeLabel,
          materialId,
          sizeId,
          isActive: rawRow.isActive ?? true,
        };

        if (rawRow.partId && existingPartIds.has(rawRow.partId)) {
          await ctx.db
            .update(partDefinitions)
            .set(values)
            .where(eq(partDefinitions.id, rawRow.partId));
          await syncPartAliases(ctx.db, rawRow.partId, rawRow.aliases ?? "");
          updated += 1;
          continue;
        }

        const [newPart] = await ctx.db
          .insert(partDefinitions)
          .values(values)
          .returning({ id: partDefinitions.id });
        if (newPart?.id) {
          await syncPartAliases(ctx.db, newPart.id, rawRow.aliases ?? "");
          existingPartIds.add(newPart.id);
          created += 1;
        } else {
          skipped += 1;
        }
      }

      return { created, updated, skipped, total: input.rows.length };
    }),

  /**
   * Create a new part definition
   */
  createPart: hasDashboardAccess
    .input(
      z.object({
        displayName: z.string().min(1).max(255),
        description: z.string().optional().nullable(),
        imageUrl: partImageUrlInput,
        catalogId: z.string().uuid(),
        categoryId: z.string().uuid().optional().nullable(),
        categoryName: z.string().optional().nullable(),
        materialId: z.string().uuid().optional().nullable(),
        sizeNominal: z.number().optional().nullable(),
        sizeLabel: z.string().optional().nullable(),
        sizeUnitId: z.string().uuid().optional().nullable(),
        isActive: z.boolean().optional(),
        aliases: z.array(z.string().min(1).max(255)).optional(),
        supplierId: z.string().uuid().optional(),
        supplierSku: z.string().max(255).optional(),
        supplierName: z.string().optional(),
        lastKnownUnitCost: z.string().optional(),
        supplierIsPreferred: z.boolean().optional(),
        currency: z.string().max(10).default("CAD"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;

      if (!organizationId) {
        throw new Error("User must belong to an organization");
      }

      const [catalog] = await ctx.db
        .select()
        .from(catalogs)
        .where(
          and(
            eq(catalogs.id, input.catalogId),
            eq(catalogs.organizationId, organizationId),
          ),
        )
        .limit(1);

      if (!catalog) {
        throw new Error("Catalog not found");
      }

      let categoryId: string | null = input.categoryId ?? null;
      const categoryName = input.categoryName?.trim() || "";
      if (!categoryId && categoryName) {
        const [existingCategory] = await ctx.db
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.name, categoryName),
              eq(categories.organizationId, organizationId),
            ),
          )
          .limit(1);

        if (existingCategory) {
          categoryId = existingCategory.id;
        } else {
          const [newCategory] = await ctx.db
            .insert(categories)
            .values({
              name: categoryName,
              organizationId: organizationId,
              sortOrder: 0,
            })
            .returning();
          categoryId = newCategory?.id ?? null;
        }
      }

      // Find or create size record
      const sizeId = await findOrCreateSize(
        ctx.db,
        organizationId,
        input.sizeNominal ?? null,
        input.sizeUnitId ?? null,
      );

      const [newPart] = await ctx.db
        .insert(partDefinitions)
        .values({
          organizationId: organizationId,
          catalogId: catalog.id,
          displayName: input.displayName,
          description: input.description ?? null,
          imageUrl:
            input.imageUrl && input.imageUrl.trim() !== ""
              ? input.imageUrl
              : null,
          categoryId: categoryId,
          sizeLabel: input.sizeLabel?.trim() || null,
          materialId: input.materialId ?? null,
          sizeId: sizeId,
          isActive: input.isActive ?? true,
        })
        .returning();

      if (!newPart) {
        throw new Error("Failed to create part definition");
      }

      if (input.aliases !== undefined) {
        await syncPartAliases(ctx.db, newPart.id, input.aliases);
      }

      // If supplier info provided, create supplier part link
      if (input.supplierId) {
        // Verify supplier exists
        const [supplier] = await ctx.db
          .select()
          .from(suppliers)
          .where(eq(suppliers.id, input.supplierId))
          .limit(1);

        if (supplier) {
          // Check if this supplier already has this part
          const [existingSupplierPart] = await ctx.db
            .select()
            .from(supplierParts)
            .where(
              and(
                eq(supplierParts.supplierId, input.supplierId),
                eq(supplierParts.partDefinitionId, newPart.id),
                eq(supplierParts.organizationId, organizationId),
              ),
            )
            .limit(1);

          if (!existingSupplierPart) {
            // Create supplier part
            await ctx.db.insert(supplierParts).values({
              organizationId: organizationId,
              supplierId: input.supplierId,
              partDefinitionId: newPart.id,
              supplierSku: input.supplierSku ?? null,
              supplierName: input.supplierName ?? null,
              lastKnownUnitCost: input.lastKnownUnitCost ?? null,
              currency: input.currency ?? "CAD",
              isPreferred: input.supplierIsPreferred ?? false,
            });
          }
        }
      }

      // Return part with full details (similar to getPart)
      const [part] = await ctx.db
        .select({
          id: partDefinitions.id,
          displayName: partDefinitions.displayName,
          description: partDefinitions.description,
          imageUrl: partDefinitions.imageUrl,
          sizeLabel: partDefinitions.sizeLabel,
          catalogId: partDefinitions.catalogId,
          categoryId: partDefinitions.categoryId,
          materialId: partDefinitions.materialId,
          materialName: materials.name,
          sizeNominal: sizes.nominal,
          sizeUnitId: sizes.unitId,
          isActive: partDefinitions.isActive,
          organizationId: partDefinitions.organizationId,
          sizeUnitCode: units.code,
          sizeUnitDisplayName: units.displayName,
        })
        .from(partDefinitions)
        .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
        .leftJoin(units, eq(sizes.unitId, units.id))
        .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
        .where(eq(partDefinitions.id, newPart.id))
        .limit(1);

      if (!part) {
        throw new Error("Failed to retrieve created part");
      }

      return {
        id: part.id,
        displayName: part.displayName,
        description: part.description,
        imageUrl: part.imageUrl,
        catalogId: part.catalogId,
        categoryId: part.categoryId,
        material: part.materialName,
        sizeNominal: part.sizeNominal,
        sizeLabel: part.sizeLabel,
        sizeUnitId: part.sizeUnitId,
        isActive: part.isActive,
        isOrgSpecific: part.organizationId === organizationId,
        sizeUnit: part.sizeUnitId
          ? {
              id: part.sizeUnitId,
              code: part.sizeUnitCode,
              displayName: part.sizeUnitDisplayName,
            }
          : null,
      };
    }),
});
