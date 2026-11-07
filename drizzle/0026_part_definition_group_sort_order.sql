ALTER TABLE "kublai_part_definition"
  ADD COLUMN IF NOT EXISTS "sortOrder" integer DEFAULT 0 NOT NULL;

WITH ranked_parts AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY
        "organizationId",
        "catalogId",
        "materialId",
        "sizeId",
        "categoryId"
      ORDER BY
        "displayName",
        "id"
    ) - 1 AS "nextSortOrder"
  FROM "kublai_part_definition"
)
UPDATE "kublai_part_definition" pd
SET "sortOrder" = ranked_parts."nextSortOrder"
FROM ranked_parts
WHERE pd."id" = ranked_parts."id";

CREATE INDEX IF NOT EXISTS "part_def_group_sort_idx"
  ON "kublai_part_definition" (
    "organizationId",
    "catalogId",
    "materialId",
    "sizeId",
    "categoryId",
    "sortOrder"
  );
