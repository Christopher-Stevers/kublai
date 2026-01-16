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
          materialId: partDefinitions.materialId,
          materialName: materials.name,
          partTypeId: partDefinitions.partTypeId,
          partTypeName: partTypes.name,
          sizeNominal: partDefinitions.sizeNominal,
          sizeUnitId: partDefinitions.sizeUnitId,
          categoryId: partDefinitions.categoryId,
          organizationId: partDefinitions.organizationId,
          sizeUnitCode: units.code,
        })
        .from(partDefinitions)
        .leftJoin(units, eq(partDefinitions.sizeUnitId, units.id))
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
      if (input.partTypeId) {
        conditions.push(eq(partDefinitions.partTypeId, input.partTypeId));
      }

      // Material filter
      if (input.materialId) {
        conditions.push(eq(partDefinitions.materialId, input.materialId));
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
                gte(partDefinitions.sizeNominal, sizeMin.toString()),
                lte(partDefinitions.sizeNominal, sizeMax.toString()),
                eq(partDefinitions.sizeUnitId, sizeUnitRow.id),
              ),
            );
          } else {
            // Unit not found, just filter by size
            conditions.push(
              gte(partDefinitions.sizeNominal, sizeMin.toString()),
            );
            conditions.push(
              lte(partDefinitions.sizeNominal, sizeMax.toString()),
            );
          }
        } else {
          // No unit specified, filter by size only
          conditions.push(gte(partDefinitions.sizeNominal, sizeMin.toString()));
          conditions.push(lte(partDefinitions.sizeNominal, sizeMax.toString()));
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
          isNotNull(partAttributes.valueNum),
        ];

        if (input.attributeValueMin !== undefined) {
          attrConditions.push(
            gte(partAttributes.valueNum, input.attributeValueMin),
          );
        }
        if (input.attributeValueMax !== undefined) {
          attrConditions.push(
            lte(partAttributes.valueNum, input.attributeValueMax),
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
          materialId: partDefinitions.materialId,
          materialName: materials.name,
          partTypeId: partDefinitions.partTypeId,
          partTypeName: partTypes.name,
          sizeNominal: partDefinitions.sizeNominal,
          sizeUnitId: partDefinitions.sizeUnitId,
          categoryId: partDefinitions.categoryId,
          organizationId: partDefinitions.organizationId,
          sizeUnitCode: units.code,
        })
        .from(partDefinitions)
        .leftJoin(units, eq(partDefinitions.sizeUnitId, units.id))
        .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
        .leftJoin(partTypes, eq(partDefinitions.partTypeId, partTypes.id))
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
        material: part.materialName,
        partType: part.partTypeName,
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
   * Combines materials from materials table (both org-specific and global)
   * Returns materials with id and name
   */
  getMaterials: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

    // Get materials from materials table (org-specific and global)
    const allMaterials = await ctx.db
      .select({
        id: materials.id,
        name: materials.name,
      })
      .from(materials)
      .where(
        organizationId
          ? or(
              eq(materials.organizationId, organizationId),
              isNull(materials.organizationId),
            )
          : isNull(materials.organizationId),
      )
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
          organizationId
            ? or(
                eq(partDefinitions.organizationId, organizationId),
                isNull(partDefinitions.organizationId),
              )
            : isNull(partDefinitions.organizationId),
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
   */
  getPartTypeCategories: hasDashboardAccess.query(async ({ ctx }) => {
    const organizationId = ctx.user.organizationId;

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

    // Build category tree
    const categoryTree = buildCategoryTree(allCategories);

    // Get parts with their categories
    const partsWithCategories = await ctx.db
      .select({
        categoryId: partDefinitions.categoryId,
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
          isNotNull(partDefinitions.categoryId),
        ),
      );

    // Create a map of category ID to category name
    const categoryMap = new Map<string, string>();
    for (const cat of allCategories) {
      categoryMap.set(cat.id, cat.name);
    }

    // Find parent categories for parts
    const parentCategorySet = new Set<string>();
    for (const part of partsWithCategories) {
      if (part.categoryId) {
        // Find the category in the tree
        const findCategory = (nodes: CategoryNode[]): CategoryNode | null => {
          for (const node of nodes) {
            if (node.id === part.categoryId) {
              return node;
            }
            const found = findCategory(node.children);
            if (found) return found;
          }
          return null;
        };

        const category = findCategory(categoryTree);
        if (category && category.parentId) {
          // Get parent category name
          const parentName = categoryMap.get(category.parentId);
          if (parentName) {
            parentCategorySet.add(parentName);
          }
        } else if (category && !category.parentId) {
          // This is a root category, use it directly
          parentCategorySet.add(category.name);
        }
      }
    }

    return Array.from(parentCategorySet).sort();
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

      // Build conditions for part definitions query
      const conditions = [
        eq(partDefinitions.isActive, true),
        organizationId
          ? or(
              eq(partDefinitions.organizationId, organizationId),
              isNull(partDefinitions.organizationId),
            )
          : isNull(partDefinitions.organizationId),
        isNotNull(partDefinitions.partTypeId),
      ];

      // Filter by parent category if provided
      if (input?.category) {
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

        // Build category tree
        const categoryTree = buildCategoryTree(allCategories);

        // Find parent category by name
        const findParentCategory = (
          nodes: CategoryNode[],
          parentName: string,
        ): CategoryNode | null => {
          for (const node of nodes) {
            if (node.name === parentName && !node.parentId) {
              return node;
            }
            const found = findParentCategory(node.children, parentName);
            if (found) return found;
          }
          return null;
        };

        const parentCategory = findParentCategory(categoryTree, input.category);
        if (parentCategory) {
          // Collect all descendant category IDs (including the parent)
          const descendantIds = collectDescendantCategoryIds(
            categoryTree,
            parentCategory.id,
          );
          conditions.push(inArray(partDefinitions.categoryId, descendantIds));
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
        materialId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.user.organizationId;

      // Get sizes from sizes table
      const customSizes = organizationId
        ? await ctx.db
            .select({
              nominal: sizes.nominal,
              unitId: sizes.unitId,
              unitCode: units.code,
            })
            .from(sizes)
            .innerJoin(units, eq(sizes.unitId, units.id))
            .where(eq(sizes.organizationId, organizationId))
        : [];

      // Get sizes from part definitions (filtered by material if provided)
      const partDefConditions = [
        eq(partDefinitions.isActive, true),
        organizationId
          ? or(
              eq(partDefinitions.organizationId, organizationId),
              isNull(partDefinitions.organizationId),
            )
          : isNull(partDefinitions.organizationId),
        isNotNull(partDefinitions.sizeNominal),
        isNotNull(partDefinitions.sizeUnitId),
      ];

      if (input.materialId) {
        partDefConditions.push(
          eq(partDefinitions.materialId, input.materialId),
        );
      }

      const partDefSizes = await ctx.db
        .selectDistinct({
          nominal: partDefinitions.sizeNominal,
          unitId: partDefinitions.sizeUnitId,
          unitCode: units.code,
        })
        .from(partDefinitions)
        .innerJoin(units, eq(partDefinitions.sizeUnitId, units.id))
        .where(and(...partDefConditions));

      // Combine and deduplicate
      const sizeMap = new Map<string, { nominal: number; unit: string }>();
      for (const s of customSizes) {
        const key = `${s.nominal}_${s.unitCode}`;
        if (!sizeMap.has(key)) {
          sizeMap.set(key, {
            nominal: parseFloat(s.nominal.toString()),
            unit: s.unitCode ?? "",
          });
        }
      }
      for (const s of partDefSizes) {
        if (s.nominal && s.unitCode) {
          const key = `${s.nominal}_${s.unitCode}`;
          if (!sizeMap.has(key)) {
            sizeMap.set(key, {
              nominal: parseFloat(s.nominal.toString()),
              unit: s.unitCode,
            });
          }
        }
      }

      return Array.from(sizeMap.values()).sort((a, b) => {
        if (a.unit !== b.unit) {
          return a.unit.localeCompare(b.unit);
        }
        return a.nominal - b.nominal;
      });
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
          categoryId: partDefinitions.categoryId,
          partTypeId: partDefinitions.partTypeId,
          partTypeName: partTypes.name,
          materialId: partDefinitions.materialId,
          materialName: materials.name,
          sizeNominal: partDefinitions.sizeNominal,
          sizeUnitId: partDefinitions.sizeUnitId,
          defaultUomId: partDefinitions.defaultUomId,
          isActive: partDefinitions.isActive,
          organizationId: partDefinitions.organizationId,
          sizeUnitCode: units.code,
          sizeUnitDisplayName: units.displayName,
        })
        .from(partDefinitions)
        .leftJoin(units, eq(partDefinitions.sizeUnitId, units.id))
        .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
        .leftJoin(partTypes, eq(partDefinitions.partTypeId, partTypes.id))
        .where(
          and(
            eq(partDefinitions.id, input.partId),
            organizationId
              ? or(
                  eq(partDefinitions.organizationId, organizationId),
                  isNull(partDefinitions.organizationId),
                )
              : isNull(partDefinitions.organizationId),
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
              ? or(
                  eq(partDefinitions.organizationId, organizationId),
                  isNull(partDefinitions.organizationId),
                )
              : isNull(partDefinitions.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new Error("Part not found or access denied");
      }

      // Only allow editing org-specific parts or creating org-specific copies of global parts
      const isGlobal = !existing.organizationId;
      const isOrgSpecific = existing.organizationId === organizationId;

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

        // Create org-specific copy
        const [newPart] = await ctx.db
          .insert(partDefinitions)
          .values({
            organizationId: organizationId,
            categoryId: input.categoryId ?? originalPart.categoryId,
            displayName: input.displayName ?? originalPart.displayName,
            description: input.description ?? originalPart.description,
            imageUrl: input.imageUrl ?? originalPart.imageUrl,
            partTypeId: input.partTypeId ?? originalPart.partTypeId,
            materialId: input.materialId ?? originalPart.materialId,
            sizeNominal:
              input.sizeNominal !== undefined && input.sizeNominal !== null
                ? input.sizeNominal.toString()
                : originalPart.sizeNominal,
            sizeUnitId: input.sizeUnitId ?? originalPart.sizeUnitId,
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
      if (input.categoryId !== undefined)
        updateData.categoryId = input.categoryId;
      if (input.partTypeId !== undefined)
        updateData.partTypeId = input.partTypeId;
      if (input.materialId !== undefined)
        updateData.materialId = input.materialId;
      if (input.sizeNominal !== undefined)
        updateData.sizeNominal = input.sizeNominal?.toString() ?? null;
      if (input.sizeUnitId !== undefined)
        updateData.sizeUnitId = input.sizeUnitId;
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

      // Get or create "Other" category if no category provided
      let categoryName = input.categoryName;
      if (!categoryName) {
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
          categoryName = existing.id;
        } else {
          // Create "Other" category
          const [newCategory] = await ctx.db
            .insert(categories)
            .values({
              name: "Other",
              organizationId: organizationId,
              sortOrder: 9999, // Put it at the end
            })
            .returning();
          categoryName = newCategory.id;
        }
      }

      // Create part definition
      const [category] = await ctx.db
        .select()
        .from(categories)
        .where(eq(categories.name, categoryName))
        .limit(1);

      if (!category) {
        throw new Error("Category not found");
      }
      console.log(category.id, "category id");
      console.log(categoryName, "category id");
      const [newPart] = await ctx.db
        .insert(partDefinitions)
        .values({
          organizationId: organizationId,
          displayName: input.displayName,
          description: input.description ?? null,
          imageUrl:
            input.imageUrl && input.imageUrl.trim() !== ""
              ? input.imageUrl
              : null,
          categoryId: category.id,
          partTypeId: input.partTypeId ?? null,
          materialId: input.materialId ?? null,
          sizeNominal:
            input.sizeNominal !== undefined && input.sizeNominal !== null
              ? input.sizeNominal.toString()
              : null,
          sizeUnitId: input.sizeUnitId ?? null,
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
          categoryId: partDefinitions.categoryId,
          partTypeId: partDefinitions.partTypeId,
          partTypeName: partTypes.name,
          materialId: partDefinitions.materialId,
          materialName: materials.name,
          sizeNominal: partDefinitions.sizeNominal,
          sizeUnitId: partDefinitions.sizeUnitId,
          defaultUomId: partDefinitions.defaultUomId,
          isActive: partDefinitions.isActive,
          organizationId: partDefinitions.organizationId,
          sizeUnitCode: units.code,
          sizeUnitDisplayName: units.displayName,
        })
        .from(partDefinitions)
        .leftJoin(units, eq(partDefinitions.sizeUnitId, units.id))
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
