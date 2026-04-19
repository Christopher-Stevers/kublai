import { z } from "zod";
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
  partTypes,
} from "~/server/db/schema";

import { parseSizeInput } from "~/lib/size-utils";

// Helper function to find or create a size record
async function findOrCreateSize(
  db: Parameters<Parameters<typeof hasDashboardAccess.query>[0]>[0]["ctx"]["db"],
  organizationId: string,
  sizeNominal: number | null | undefined,
  sizeUnitId: string | null | undefined,
): Promise<string | null> {
  if (!sizeNominal || !sizeUnitId) {
    // If no size provided, find or create a default "no size" size (nominal=0)
    const [defaultSize] = await db
      .select()
      .from(sizes)
      .where(
        and(
          eq(sizes.organizationId, organizationId),
          eq(sizes.nominal, "0"),
        ),
      )
      .limit(1);

    if (defaultSize) {
      return defaultSize.id;
    }

    // Get a default unit (first unit in the system)
    const [defaultUnit] = await db.select().from(units).limit(1);
    if (!defaultUnit) {
      throw new Error("No units found in database");
    }

    const [newDefaultSize] = await db
      .insert(sizes)
      .values({
        organizationId,
        nominal: "0",
        unitId: defaultUnit.id,
      })
      .returning();

    return newDefaultSize?.id ?? null;
  }

  // Find existing size
  const [existingSize] = await db
    .select()
    .from(sizes)
    .where(
      and(
        eq(sizes.organizationId, organizationId),
        eq(sizes.nominal, sizeNominal.toString()),
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
      nominal: sizeNominal.toString(),
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

      if (!organizationId) {
        throw new Error("User must belong to an organization");
      }

      const [maxSortOrder] = await ctx.db
        .select({ maxSortOrder: sql<number>`coalesce(max(${catalogs.sortOrder}), -1)` })
        .from(catalogs)
        .where(eq(catalogs.organizationId, organizationId));

      const [newCatalog] = await ctx.db
        .insert(catalogs)
        .values({
          organizationId,
          name: input.name.trim(),
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
          materialId: partDefinitions.materialId,
          materialName: materials.name,
          partTypeId: partDefinitions.partTypeId,
          partTypeName: partTypes.name,
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
        .leftJoin(partTypes, eq(partDefinitions.partTypeId, partTypes.id))
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
          part.sizeNominal && part.sizeUnitCode
            ? `${part.sizeNominal} ${part.sizeUnitCode}`
            : null,
        sizeNominal: part.sizeNominal,
        sizeUnit: part.sizeUnitCode,
        catalogId: part.catalogId,
        categoryId: part.categoryId,
        isOrgSpecific: part.organizationId === organizationId,
      }));
    }),

  /**
   * Faceted search with full filtering support
   * Supports: text search, category, partType, material, size (normalized), and attributes
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
        partTypeId: z.string().uuid().optional(),
        materialId: z.string().uuid().optional(),
        // Size filtering (normalized)
        sizeNominal: z.number().optional(), // Normalized value (0.5 for 1/2)
        sizeUnit: z.string().optional(), // "in", "mm", etc.
        sizeTolerance: z.number().optional().default(0.01), // For range matching
        // Attribute filters (MVP: volume, flow_rate)
        attributeKey: z.string().optional(), // "volume", "flow_rate"
        attributeValueMin: z.number().optional(),
        attributeValueMax: z.number().optional(),
        attributeUnit: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      console.log(JSON.stringify(input), "searchParts input");
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
      if (input.partTypeId) {
        conditions.push(eq(partDefinitions.partTypeId, input.partTypeId));
      }

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
      const sizeJoinConditions: Array<ReturnType<typeof gte> | ReturnType<typeof lte> | ReturnType<typeof eq>> = [];
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
          materialId: partDefinitions.materialId,
          materialName: materials.name,
          partTypeId: partDefinitions.partTypeId,
          partTypeName: partTypes.name,
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
        .leftJoin(partTypes, eq(partDefinitions.partTypeId, partTypes.id))
        .where(
          and(
            ...conditions,
            ...(sizeJoinConditions.length > 0 ? sizeJoinConditions : []),
          ),
        )
        .limit(200); // Increased limit for better results

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
        partType: part.partTypeName,
        size:
          part.sizeNominal && part.sizeUnitCode
            ? `${part.sizeNominal} ${part.sizeUnitCode}`
            : null,
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

      if (!organizationId) {
        throw new Error("User must belong to an organization");
      }

      const [newMaterial] = await ctx.db
        .insert(materials)
        .values({
          organizationId: organizationId,
          name: input.name.trim(),
        })
        .returning();

      return newMaterial;
    }),

  /**
   * Get distinct part type categories (top-level: Fittings, Valves, Pipes, etc.)
   * Derived from parent categories of parts
   * Can optionally filter by material and size
   */
  getPartTypeCategories: hasDashboardAccess
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

      // For each category, count # of active parts in that category
      const categoriesWithCount = await Promise.all(
        allCategories.map(async (cat) => {
          const countConditions: Array<ReturnType<typeof eq>> = [
            ...baseConditions,
            eq(partDefinitions.categoryId, cat.id),
          ];

          // If size filtering is needed, join with sizes table
          if (sizeJoinNeeded && input?.sizeNominal !== undefined) {
            const tolerance = 0.01;
            const sizeMin = (input.sizeNominal - tolerance).toString();
            const sizeMax = (input.sizeNominal + tolerance).toString();

            const sizeConditions: Array<ReturnType<typeof gte> | ReturnType<typeof lte> | ReturnType<typeof eq>> = [
              gte(sizes.nominal, sizeMin),
              lte(sizes.nominal, sizeMax),
            ];

            if (sizeUnitId) {
              sizeConditions.push(eq(sizes.unitId, sizeUnitId));
            }

            const result = await ctx.db
              .select({ count: sql<number>`count(*)` })
              .from(partDefinitions)
              .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
              .where(and(...countConditions, ...sizeConditions));

            const count = Number(result[0]?.count ?? 0);

            return {
              id: cat.id,
              name: cat.name,
              count: count,
            };
          } else {
            const result = await ctx.db
              .select({ count: sql<number>`count(*)` })
              .from(partDefinitions)
              .where(and(...countConditions));

            const count = Number(result[0]?.count ?? 0);

            return {
              id: cat.id,
              name: cat.name,
              count: count,
            };
          }
        }),
      );

      const result = await Promise.all(
        categoriesWithCount
          .filter((cat) => cat.count > 0)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(async (cat) => ({
            categoryId: cat.id,
            name: cat.name,
            count: cat.count,
          })),
      );
      return result;
    }),

  /**
   * Get distinct part types for filter dropdown
   * Combines part types from partTypes table and part definitions
   * Can optionally filter by category
   */
  getPartTypes: hasDashboardAccess
    .input(
      z
        .object({
          category: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;

      // Get part types from partTypes table
      const customPartTypes = organizationId
        ? await ctx.db
            .select({
              name: partTypes.name,
            })
            .from(partTypes)
            .where(eq(partTypes.organizationId, organizationId))
            .orderBy(partTypes.name)
        : [];

      if (!organizationId) {
        return [];
      }

      // Build conditions for part definitions query
      const conditions = [
        eq(partDefinitions.isActive, true),
        eq(partDefinitions.organizationId, organizationId),
        isNotNull(partDefinitions.partTypeId),
      ];

      // Filter by category if provided (direct match, no subcategories)
      if (input?.category) {
        const [category] = await ctx.db
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.name, input.category),
              eq(categories.organizationId, organizationId),
            ),
          )
          .limit(1);

        if (category) {
          conditions.push(eq(partDefinitions.categoryId, category.id));
        }
      }

      // Get part types from part definitions (via join)
      const partDefPartTypes = await ctx.db
        .selectDistinct({
          partTypeName: partTypes.name,
        })
        .from(partDefinitions)
        .innerJoin(partTypes, eq(partDefinitions.partTypeId, partTypes.id))
        .where(and(...conditions))
        .orderBy(partTypes.name);

      // Combine and deduplicate
      const partTypeSet = new Set<string>();
      for (const pt of customPartTypes) {
        partTypeSet.add(pt.name);
      }
      for (const pt of partDefPartTypes) {
        if (pt.partTypeName) {
          partTypeSet.add(pt.partTypeName);
        }
      }

      return Array.from(partTypeSet).sort();
    }),

  /**
   * Get part types with IDs for lookup
   */
  getPartTypesWithIds: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    // Get part types from partTypes table
    const customPartTypes = organizationId
      ? await ctx.db
          .select({
            id: partTypes.id,
            name: partTypes.name,
          })
          .from(partTypes)
          .where(eq(partTypes.organizationId, organizationId))
          .orderBy(partTypes.name)
      : [];

    // Get part types from part definitions (via join)
    const partDefPartTypes = await ctx.db
      .selectDistinct({
        id: partTypes.id,
        name: partTypes.name,
      })
      .from(partDefinitions)
      .innerJoin(partTypes, eq(partDefinitions.partTypeId, partTypes.id))
      .where(
        and(
          eq(partDefinitions.isActive, true),
          isNotNull(partDefinitions.partTypeId),
          eq(partDefinitions.organizationId, organizationId),
        ),
      )
      .orderBy(partTypes.name);

    // Combine and deduplicate by ID
    const partTypeMap = new Map<string, { id: string; name: string }>();
    for (const pt of customPartTypes) {
      partTypeMap.set(pt.id, { id: pt.id, name: pt.name });
    }
    for (const pt of partDefPartTypes) {
      partTypeMap.set(pt.id, { id: pt.id, name: pt.name });
    }

    return Array.from(partTypeMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }),

  /**
   * Create a custom part type
   */
  createPartType: hasDashboardAccess
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;

      if (!organizationId) {
        throw new Error("User must belong to an organization");
      }
      console.log(organizationId, input.name, "my name input");
      try {
        const [newPartType] = await ctx.db
          .insert(partTypes)
          .values({
            organizationId: organizationId,
            name: input.name.trim(),
          })
          .returning();

        return newPartType;
      } catch (error) {
        console.error("Error creating part type:", error);
        throw new Error("Failed to create part type");
      }
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

      if (!organizationId) {
        throw new Error("User must belong to an organization");
      }

      const [newCategory] = await ctx.db
        .insert(categories)
        .values({
          organizationId: organizationId,
          name: input.name.trim(),
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

      const uniqueSizes = await ctx.db
        .selectDistinct({
          sizeId: partDefinitions.sizeId,
          nominal: sizes.nominal,
          unitId: sizes.unitId,
          unitCode: units.code,
        })
        .from(partDefinitions)
        .innerJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
        .innerJoin(units, eq(sizes.unitId, units.id))
        .where(and(...sizeConditions));

      // For each unique size, count the parts that match
      const sizesWithCounts = uniqueSizes.map(async (size) => {
        const countConditions = [
          eq(partDefinitions.sizeId, size.sizeId),
          eq(partDefinitions.isActive, true),
          eq(partDefinitions.organizationId, organizationId),
        ];

        if (input.materialId) {
          countConditions.push(eq(partDefinitions.materialId, input.materialId));
        }

        const [partCount] = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(partDefinitions)
          .where(and(...countConditions))
          .limit(1);

        return {
          nominal: parseFloat(size.nominal ?? "0") ?? 0,
          unitId: size.unitId ?? "",
          unit: size.unitCode ?? "",
          count: (partCount?.count as number) ?? 0,
        };
      });

      return Promise.all(sizesWithCounts);
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
          catalogId: partDefinitions.catalogId,
          categoryId: partDefinitions.categoryId,
          partTypeId: partDefinitions.partTypeId,
          partTypeName: partTypes.name,
          materialId: partDefinitions.materialId,
          materialName: materials.name,
          sizeNominal: sizes.nominal,
          sizeUnitId: sizes.unitId,
          defaultUomId: partDefinitions.defaultUomId,
          isActive: partDefinitions.isActive,
          organizationId: partDefinitions.organizationId,
          sizeUnitCode: units.code,
          sizeUnitDisplayName: units.displayName,
        })
        .from(partDefinitions)
        .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
        .leftJoin(units, eq(sizes.unitId, units.id))
        .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
        .leftJoin(partTypes, eq(partDefinitions.partTypeId, partTypes.id))
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

      // Get default UOM separately
      let defaultUom = null;
      if (part.defaultUomId) {
        const [uom] = await ctx.db
          .select({
            id: units.id,
            code: units.code,
            displayName: units.displayName,
          })
          .from(units)
          .where(eq(units.id, part.defaultUomId))
          .limit(1);
        defaultUom = uom ?? null;
      }

      return {
        id: part.id,
        displayName: part.displayName,
        description: part.description,
        imageUrl: part.imageUrl,
        catalogId: part.catalogId,
        categoryId: part.categoryId,
        partType: part.partTypeName,
        material: part.materialName,
        sizeNominal: part.sizeNominal,
        sizeUnitId: part.sizeUnitId,
        defaultUomId: part.defaultUomId,
        isActive: part.isActive,
        isOrgSpecific: part.organizationId === organizationId,
        sizeUnit: part.sizeUnitId
          ? {
              id: part.sizeUnitId,
              code: part.sizeUnitCode,
              displayName: part.sizeUnitDisplayName,
            }
          : null,
        defaultUom,
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
        partTypeId: z.string().uuid().optional().nullable(),
        materialId: z.string().uuid().optional().nullable(),
        sizeNominal: z.number().optional().nullable(),
        sizeUnitId: z.string().uuid().optional().nullable(),
        defaultUomId: z.string().uuid().optional().nullable(),
        isActive: z.boolean().optional(),
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

      // Handle size: find or create size record
      let sizeId: string | null = null;
      if (
        input.sizeNominal !== undefined ||
        input.sizeUnitId !== undefined
      ) {
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
            input.sizeUnitId ?? currentSize?.unitId ?? null;

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

        // Use provided sizeId or original part's sizeId
        const finalSizeId = sizeId ?? originalPart.sizeId;

        // Create org-specific copy
        const [newPart] = await ctx.db
          .insert(partDefinitions)
          .values({
            organizationId: organizationId,
            catalogId: input.catalogId ?? originalPart.catalogId,
            categoryId: input.categoryId ?? originalPart.categoryId,
            displayName: input.displayName ?? originalPart.displayName,
            description: input.description ?? originalPart.description,
            imageUrl: input.imageUrl ?? originalPart.imageUrl,
            partTypeId: input.partTypeId ?? originalPart.partTypeId,
            materialId: input.materialId ?? originalPart.materialId,
            sizeId: finalSizeId,
            defaultUomId: input.defaultUomId ?? originalPart.defaultUomId,
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
      if (input.catalogId !== undefined)
        updateData.catalogId = input.catalogId;
      if (input.categoryId !== undefined)
        updateData.categoryId = input.categoryId;
      if (input.partTypeId !== undefined)
        updateData.partTypeId = input.partTypeId;
      if (input.materialId !== undefined)
        updateData.materialId = input.materialId;
      if (sizeId !== null) updateData.sizeId = sizeId;
      if (input.defaultUomId !== undefined)
        updateData.defaultUomId = input.defaultUomId;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      const [updated] = await ctx.db
        .update(partDefinitions)
        .set(updateData)
        .where(eq(partDefinitions.id, input.partId))
        .returning();

      if (!updated) {
        throw new Error("Failed to update part");
      }

      return updated;
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

  /**
   * Create a new part definition
   */
  createPart: hasDashboardAccess
    .input(
      z.object({
        displayName: z.string().min(1).max(255),
        description: z.string().optional().nullable(),
        imageUrl: z
          .union([z.string().url(), z.literal(""), z.null(), z.undefined()])
          .optional()
          .nullable()
          .transform((val) => (val === "" ? null : val)),
        catalogId: z.string().uuid(),
        categoryId: z.string().uuid().optional().nullable(),
        categoryName: z.string().optional().nullable(),
        partTypeId: z.string().uuid().optional().nullable(),
        materialId: z.string().uuid().optional().nullable(),
        sizeNominal: z.number().optional().nullable(),
        sizeUnitId: z.string().uuid().optional().nullable(),
        defaultUomId: z.string().uuid().optional().nullable(),
        supplierId: z.string().uuid().optional(),
        supplierSku: z.string().max(255).optional(),
        supplierName: z.string().optional(),
        lastKnownUnitCost: z.string().optional(),
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
      if (!categoryId) {
        let categoryName = input.categoryName;
        if (!categoryName) {
          categoryName = "Other";
        }

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
              sortOrder: categoryName === "Other" ? 9999 : 0,
            })
            .returning();
          categoryId = newCategory?.id ?? null;
        }
      }

      if (!categoryId) {
        throw new Error("Category not found");
      }

      // Find or create size record
      const sizeId = await findOrCreateSize(
        ctx.db,
        organizationId,
        input.sizeNominal ?? null,
        input.sizeUnitId ?? null,
      );

      if (!sizeId) {
        throw new Error("Failed to create or find size record");
      }

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
          partTypeId: input.partTypeId ?? null,
          materialId: input.materialId ?? null,
          sizeId: sizeId,
          defaultUomId: input.defaultUomId ?? null,
          isActive: true,
        })
        .returning();

      if (!newPart) {
        throw new Error("Failed to create part definition");
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
              isPreferred: false,
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
          catalogId: partDefinitions.catalogId,
          categoryId: partDefinitions.categoryId,
          partTypeId: partDefinitions.partTypeId,
          partTypeName: partTypes.name,
          materialId: partDefinitions.materialId,
          materialName: materials.name,
          sizeNominal: sizes.nominal,
          sizeUnitId: sizes.unitId,
          defaultUomId: partDefinitions.defaultUomId,
          isActive: partDefinitions.isActive,
          organizationId: partDefinitions.organizationId,
          sizeUnitCode: units.code,
          sizeUnitDisplayName: units.displayName,
        })
        .from(partDefinitions)
        .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
        .leftJoin(units, eq(sizes.unitId, units.id))
        .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
        .leftJoin(partTypes, eq(partDefinitions.partTypeId, partTypes.id))
        .where(eq(partDefinitions.id, newPart.id))
        .limit(1);

      if (!part) {
        throw new Error("Failed to retrieve created part");
      }

      // Get default UOM if provided
      let defaultUom = null;
      if (part.defaultUomId) {
        const [uom] = await ctx.db
          .select({
            id: units.id,
            code: units.code,
            displayName: units.displayName,
          })
          .from(units)
          .where(eq(units.id, part.defaultUomId))
          .limit(1);
        defaultUom = uom ?? null;
      }

      return {
        id: part.id,
        displayName: part.displayName,
        description: part.description,
        imageUrl: part.imageUrl,
        catalogId: part.catalogId,
        categoryId: part.categoryId,
        partType: part.partTypeName,
        material: part.materialName,
        sizeNominal: part.sizeNominal,
        sizeUnitId: part.sizeUnitId,
        defaultUomId: part.defaultUomId,
        isActive: part.isActive,
        isOrgSpecific: part.organizationId === organizationId,
        sizeUnit: part.sizeUnitId
          ? {
              id: part.sizeUnitId,
              code: part.sizeUnitCode,
              displayName: part.sizeUnitDisplayName,
            }
          : null,
        defaultUom,
      };
    }),
});
