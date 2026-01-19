import { db } from "~/server/db";
import { categories, partDefinitions } from "~/server/db/schema";
import { eq, isNotNull } from "drizzle-orm";

/**
 * Migration script to move part definitions from child categories to parent categories
 * and then delete all child categories.
 * 
 * This should be run BEFORE the schema migration that removes the parentId field.
 */
async function migrateCategoriesToRootOnly() {
  console.log("Starting category migration...");

  // Step 1: Find all child categories (where parentId IS NOT NULL)
  const childCategories = await db
    .select()
    .from(categories)
    .where(isNotNull(categories.parentId));

  console.log(`Found ${childCategories.length} child categories to migrate`);

  if (childCategories.length === 0) {
    console.log("No child categories found. Migration complete.");
    return;
  }

  let migratedParts = 0;
  let deletedCategories = 0;
  const errors: Array<{ category: string; error: string }> = [];

  // Step 2: For each child category, move part definitions to parent and delete child
  for (const childCategory of childCategories) {
    try {
      if (!childCategory.parentId) {
        console.warn(`Category ${childCategory.name} (${childCategory.id}) has no parentId, skipping`);
        continue;
      }

      // Get parent category
      const [parentCategory] = await db
        .select()
        .from(categories)
        .where(eq(categories.id, childCategory.parentId))
        .limit(1);

      if (!parentCategory) {
        errors.push({
          category: childCategory.name,
          error: `Parent category ${childCategory.parentId} not found`,
        });
        console.error(`Parent category not found for ${childCategory.name}`);
        continue;
      }

      // Find all part definitions linked to this child category
      const partsToMigrate = await db
        .select()
        .from(partDefinitions)
        .where(eq(partDefinitions.categoryId, childCategory.id));

      console.log(
        `Migrating ${partsToMigrate.length} parts from "${childCategory.name}" to "${parentCategory.name}"`,
      );

      // Update part definitions to point to parent category
      if (partsToMigrate.length > 0) {
        await db
          .update(partDefinitions)
          .set({ categoryId: parentCategory.id })
          .where(eq(partDefinitions.categoryId, childCategory.id));

        migratedParts += partsToMigrate.length;
      }

      // Delete the child category
      await db.delete(categories).where(eq(categories.id, childCategory.id));
      deletedCategories++;

      console.log(`✓ Migrated "${childCategory.name}" to "${parentCategory.name}"`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push({
        category: childCategory.name,
        error: errorMessage,
      });
      console.error(`Error migrating category ${childCategory.name}:`, error);
    }
  }

  // Step 3: Verify migration
  console.log("\nVerifying migration...");

  // Check for any remaining child categories
  const remainingChildren = await db
    .select()
    .from(categories)
    .where(isNotNull(categories.parentId));

  if (remainingChildren.length > 0) {
    console.warn(
      `⚠ Warning: ${remainingChildren.length} child categories still exist`,
    );
  } else {
    console.log("✓ All child categories have been deleted");
  }

  // Check for any part definitions pointing to deleted categories
  // (This is a sanity check - if we did it right, all parts should point to root categories)
  const allCategories = await db.select().from(categories);
  const categoryIds = new Set(allCategories.map((c) => c.id));

  const orphanedParts = await db
    .select()
    .from(partDefinitions)
    .where(isNotNull(partDefinitions.categoryId));

  const orphanedCount = orphanedParts.filter(
    (p) => p.categoryId && !categoryIds.has(p.categoryId),
  ).length;

  if (orphanedCount > 0) {
    console.warn(`⚠ Warning: ${orphanedCount} parts may be orphaned`);
  } else {
    console.log("✓ All parts are linked to valid categories");
  }

  // Migration report
  console.log("\n=== Migration Report ===");
  console.log(`Child categories processed: ${childCategories.length}`);
  console.log(`Parts migrated: ${migratedParts}`);
  console.log(`Categories deleted: ${deletedCategories}`);
  console.log(`Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log("\nErrors encountered:");
    errors.forEach(({ category, error }) => {
      console.log(`  - ${category}: ${error}`);
    });
  }

  console.log("\nMigration complete!");
}

// Run migration
migrateCategoriesToRootOnly()
  .then(() => {
    console.log("Migration script finished successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });
