import { z } from "zod";
import { and, eq, ilike, inArray, isNull, or, sql, isNotNull } from "drizzle-orm";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import {
  categories,
  partDefinitions,
  partAttributes,
  partSynonyms,
  units,
} from "~/server/db/schema";

/**
 * Parse size string to normalized number
 * Handles fractions (1/2 → 0.5), decimals (0.5 → 0.5), and mixed (1 1/2 → 1.5)
 */
function parseSize(sizeStr: string): number | null {
  if (!sizeStr || typeof sizeStr !== "string") {
    return null;
  }

  const trimmed = sizeStr.trim();
  if (!trimmed) {
    return null;
  }

  // Try parsing as decimal first
  const decimal = parseFloat(trimmed);
  if (!isNaN(decimal) && isFinite(decimal)) {
    // Check if it's a pure decimal (not a fraction that happens to parse)
    if (!trimmed.includes("/")) {
      return decimal;
    }
  }

  // Handle fractions: "1/2", "3/4", etc.
  const fractionMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fractionMatch) {
    const numerator = parseFloat(fractionMatch[1] ?? "0");
    const denominator = parseFloat(fractionMatch[2] ?? "1");
    if (denominator !== 0) {
      return numerator / denominator;
    }
  }

  // Handle mixed numbers: "1 1/2", "2 3/4", etc.
  const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const whole = parseFloat(mixedMatch[1] ?? "0");
    const numerator = parseFloat(mixedMatch[2] ?? "0");
    const denominator = parseFloat(mixedMatch[3] ?? "1");
    if (denominator !== 0) {
      return whole + numerator / denominator;
    }
  }

  // If all else fails, try parsing as number
  const final = parseFloat(trimmed);
  if (!isNaN(final) && isFinite(final)) {
    return final;
  }

  return null;
}

// Type for category tree node
type CategoryNode = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  organizationId: string | null;
  children: CategoryNode[];
  partCount?: number;
};

// Helper function to build category tree
function buildCategoryTree(
  categories: Array<{
    id: string;
    name: string;
    parentId: string | null;
    sortOrder: number;
    organizationId: string | null;
  }>,
): CategoryNode[] {
  const categoryMap = new Map<string, CategoryNode>();
  const rootCategories: CategoryNode[] = [];

  // First pass: create all nodes
  for (const cat of categories) {
    categoryMap.set(cat.id, {
      ...cat,
      children: [],
    });
  }

  // Second pass: build tree structure
  for (const cat of categories) {
    const node = categoryMap.get(cat.id)!;
    if (cat.parentId) {
      const parent = categoryMap.get(cat.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Orphan node, add to root
        rootCategories.push(node);
      }
    } else {
      rootCategories.push(node);
    }
  }

  // Sort children by sortOrder, then name
  const sortCategories = (nodes: CategoryNode[]) => {
    nodes.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      sortCategories(node.children);
    }
  };

  sortCategories(rootCategories);
  return rootCategories;
}

/**
 * Recursively collect all descendant category IDs (including the root category)
 * @param tree - The category tree
 * @param categoryId - The root category ID to start from
 * @returns Array of category IDs including the root and all descendants
 */
function collectDescendantCategoryIds(
  tree: CategoryNode[],
  categoryId: string,
): string[] {
  const result: string[] = [categoryId];

  // Find the category in the tree
  const findCategory = (nodes: CategoryNode[]): CategoryNode | null => {
    for (const node of nodes) {
      if (node.id === categoryId) {
        return node;
      }
      const found = findCategory(node.children);
      if (found) return found;
    }
    return null;
  };

  const category = findCategory(tree);
  if (!category) {
    return result; // Category not found, return just the ID
  }

  // Recursively collect all child IDs
  const collectChildren = (node: CategoryNode) => {
    for (const child of node.children) {
      result.push(child.id);
      collectChildren(child);
    }
  };

  collectChildren(category);
  return result;
}

export const catalogueRouter = createTRPCRouter({
  /**
   * Get hierarchical category tree for the user's organization
   * Includes both org-specific and global categories
   */
  getCategoryTree: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    // Get all categories: org-specific OR global (organizationId IS NULL)
    // If user has no organization, show only global categories
    const allCategories = await ctx.db
      .select({
        id: categories.id,
        name: categories.name,
        parentId: categories.parentId,
        sortOrder: categories.sortOrder,
        organizationId: categories.organizationId,
      })
      .from(categories)
      .where(
        organizationId
          ? or(
              eq(categories.organizationId, organizationId),
              isNull(categories.organizationId),
            )
          : isNull(categories.organizationId),
      );

    // Build tree structure
    const tree = buildCategoryTree(allCategories);

    // Optionally add part counts to each category
    // This could be optimized with a single query, but for MVP we'll keep it simple
    const partCounts = await ctx.db
      .select({
        categoryId: partDefinitions.categoryId,
        count: sql<number>`count(*)::int`,
      })
      .from(partDefinitions)
      .where(
        and(
          eq(partDefinitions.isActive, true),
          organizationId
            ? or(
                eq(partDefinitions.organizationId, organizationId),
                isNull(partDefinitions.organizationId),
              )
            : isNull(partDefinitions.organizationId),
        ),
      )
      .groupBy(partDefinitions.categoryId);

    const countMap = new Map<string, number>();
    for (const pc of partCounts) {
      if (pc.categoryId) {
        countMap.set(pc.categoryId, pc.count);
      }
    }

    // Add counts to tree nodes recursively
    const addCounts = (nodes: CategoryNode[]): number => {
      let total = 0;
      for (const node of nodes) {
        const directCount = countMap.get(node.id) ?? 0;
        const childCount = addCounts(node.children);
        node.partCount = directCount + childCount;
        total += node.partCount;
      }
      return total;
    };

    addCounts(tree);

    return tree;
  }),

  /**
   * Get parts for a specific category
   * Returns org-specific parts first, then global parts
   */
  getPartsByCategory: hasDashboardAccess
    .input(
      z.object({
        categoryId: z.string().uuid().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;

      // Build where conditions
      const conditions = [
        eq(partDefinitions.isActive, true),
        organizationId
          ? or(
              eq(partDefinitions.organizationId, organizationId),
              isNull(partDefinitions.organizationId),
            )
          : isNull(partDefinitions.organizationId),
      ];

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
          material: partDefinitions.material,
          sizeNominal: partDefinitions.sizeNominal,
          sizeUnitId: partDefinitions.sizeUnitId,
          categoryId: partDefinitions.categoryId,
          organizationId: partDefinitions.organizationId,
          sizeUnitCode: units.code,
        })
        .from(partDefinitions)
        .leftJoin(units, eq(partDefinitions.sizeUnitId, units.id))
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
        material: part.material,
        size:
          part.sizeNominal && part.sizeUnitCode
            ? `${part.sizeNominal} ${part.sizeUnitCode}`
            : null,
        sizeNominal: part.sizeNominal,
        sizeUnit: part.sizeUnitCode,
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
        // Category filter (works with search or alone)
        categoryId: z.string().uuid().nullable().optional(),
        // Normalized filters
        partType: z.string().optional(),
        material: z.string().optional(),
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
      const organizationId = ctx.user.organizationId;

      const conditions = [
        eq(partDefinitions.isActive, true),
        organizationId
          ? or(
              eq(partDefinitions.organizationId, organizationId),
              isNull(partDefinitions.organizationId),
            )
          : isNull(partDefinitions.organizationId),
      ];

      // Category filter (includes subcategories)
      if (input.categoryId !== undefined && input.categoryId !== null) {
        // Get all categories to build tree
        const allCategories = await ctx.db
          .select({
            id: categories.id,
            name: categories.name,
            parentId: categories.parentId,
            sortOrder: categories.sortOrder,
            organizationId: categories.organizationId,
          })
          .from(categories)
          .where(
            organizationId
              ? or(
                  eq(categories.organizationId, organizationId),
                  isNull(categories.organizationId),
                )
              : isNull(categories.organizationId),
          );

        // Build tree and collect descendant IDs
        const categoryTree = buildCategoryTree(allCategories);
        const descendantIds = collectDescendantCategoryIds(
          categoryTree,
          input.categoryId,
        );

        // Filter by any of the descendant categories
        conditions.push(inArray(partDefinitions.categoryId, descendantIds));
      }

      // Part type filter
      if (input.partType) {
        conditions.push(eq(partDefinitions.partType, input.partType));
      }

      // Material filter
      if (input.material) {
        conditions.push(eq(partDefinitions.material, input.material));
      }

      // Size filter (normalized)
      if (input.sizeNominal !== undefined) {
        const tolerance = input.sizeTolerance ?? 0.01;
        const sizeMin = input.sizeNominal - tolerance;
        const sizeMax = input.sizeNominal + tolerance;

        // If sizeUnit is specified, also filter by unit
        if (input.sizeUnit) {
          // Get unit ID for the specified unit code
          const [sizeUnitRow] = await ctx.db
            .select({ id: units.id })
            .from(units)
            .where(eq(units.code, input.sizeUnit))
            .limit(1);

          if (sizeUnitRow) {
            conditions.push(
              and(
                sql`${partDefinitions.sizeNominal} >= ${sizeMin}`,
                sql`${partDefinitions.sizeNominal} <= ${sizeMax}`,
                eq(partDefinitions.sizeUnitId, sizeUnitRow.id),
              ),
            );
          } else {
            // Unit not found, just filter by size
            conditions.push(
              sql`${partDefinitions.sizeNominal} >= ${sizeMin}`,
            );
            conditions.push(sql`${partDefinitions.sizeNominal} <= ${sizeMax}`);
          }
        } else {
          // No unit specified, filter by size only
          conditions.push(
            sql`${partDefinitions.sizeNominal} >= ${sizeMin}`,
          );
          conditions.push(sql`${partDefinitions.sizeNominal} <= ${sizeMax}`);
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
          conditions.push(
            or(
              ilike(partDefinitions.displayName, searchTerm),
              ilike(partDefinitions.description, searchTerm),
              inArray(partDefinitions.id, synonymPartIds),
            ),
          );
        } else {
          conditions.push(
            or(
              ilike(partDefinitions.displayName, searchTerm),
              ilike(partDefinitions.description, searchTerm),
            ),
          );
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
          sql`${partAttributes.valueNum} IS NOT NULL`,
        ];

        if (input.attributeValueMin !== undefined) {
          attrConditions.push(
            sql`${partAttributes.valueNum} >= ${input.attributeValueMin}`,
          );
        }
        if (input.attributeValueMax !== undefined) {
          attrConditions.push(
            sql`${partAttributes.valueNum} <= ${input.attributeValueMax}`,
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

      // Build and execute query
      const allParts = await ctx.db
        .select({
          id: partDefinitions.id,
          displayName: partDefinitions.displayName,
          description: partDefinitions.description,
          imageUrl: partDefinitions.imageUrl,
          material: partDefinitions.material,
          partType: partDefinitions.partType,
          sizeNominal: partDefinitions.sizeNominal,
          sizeUnitId: partDefinitions.sizeUnitId,
          categoryId: partDefinitions.categoryId,
          organizationId: partDefinitions.organizationId,
          sizeUnitCode: units.code,
        })
        .from(partDefinitions)
        .leftJoin(units, eq(partDefinitions.sizeUnitId, units.id))
        .where(and(...conditions))
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
        material: part.material,
        partType: part.partType,
        size:
          part.sizeNominal && part.sizeUnitCode
            ? `${part.sizeNominal} ${part.sizeUnitCode}`
            : null,
        sizeNominal: part.sizeNominal,
        sizeUnit: part.sizeUnitCode,
        categoryId: part.categoryId,
        isOrgSpecific: part.organizationId === organizationId,
      }));
    }),

  /**
   * Get distinct materials for filter dropdown
   */
  getMaterials: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    const materials = await ctx.db
      .selectDistinct({
        material: partDefinitions.material,
      })
      .from(partDefinitions)
      .where(
        and(
          eq(partDefinitions.isActive, true),
          organizationId
            ? or(
                eq(partDefinitions.organizationId, organizationId),
                isNull(partDefinitions.organizationId),
              )
            : isNull(partDefinitions.organizationId),
          isNotNull(partDefinitions.material),
        ),
      )
      .orderBy(partDefinitions.material);

    return materials
      .map((m) => m.material)
      .filter((m): m is string => m !== null);
  }),

  /**
   * Get distinct part types for filter dropdown
   */
  getPartTypes: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    const partTypes = await ctx.db
      .selectDistinct({
        partType: partDefinitions.partType,
      })
      .from(partDefinitions)
      .where(
        and(
          eq(partDefinitions.isActive, true),
          organizationId
            ? or(
                eq(partDefinitions.organizationId, organizationId),
                isNull(partDefinitions.organizationId),
              )
            : isNull(partDefinitions.organizationId),
          isNotNull(partDefinitions.partType),
        ),
      )
      .orderBy(partDefinitions.partType);

    return partTypes
      .map((pt) => pt.partType)
      .filter((pt): pt is string => pt !== null);
  }),

  /**
   * Get available size units for filter dropdown
   */
  getSizeUnits: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    // Get units that are used as size units in part definitions
    const sizeUnits = await ctx.db
      .selectDistinct({
        unitCode: units.code,
        unitDisplayName: units.displayName,
      })
      .from(partDefinitions)
      .innerJoin(units, eq(partDefinitions.sizeUnitId, units.id))
      .where(
        and(
          eq(partDefinitions.isActive, true),
          organizationId
            ? or(
                eq(partDefinitions.organizationId, organizationId),
                isNull(partDefinitions.organizationId),
              )
            : isNull(partDefinitions.organizationId),
          isNotNull(partDefinitions.sizeUnitId),
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

    // Get part IDs that user has access to
    const accessiblePartIds = await ctx.db
      .select({ id: partDefinitions.id })
      .from(partDefinitions)
      .where(
        and(
          eq(partDefinitions.isActive, true),
          organizationId
            ? or(
                eq(partDefinitions.organizationId, organizationId),
                isNull(partDefinitions.organizationId),
              )
            : isNull(partDefinitions.organizationId),
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
});

