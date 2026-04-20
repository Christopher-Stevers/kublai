import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "../src/server/db";

async function main() {
  const result = await db.execute(sql`
    WITH rebuilt AS (
      SELECT
        pd.id,
        NULLIF(
          trim(
            concat_ws(
              ' ',
              CASE
                WHEN s.nominal IS NOT NULL AND u.code IS NOT NULL THEN concat(s.nominal::text, ' ', u.code)
                WHEN s.nominal IS NOT NULL THEN s.nominal::text
                ELSE NULL
              END,
              m.name,
              pd.description
            )
          ),
          ''
        ) AS next_display_name
      FROM kublai_part_definition pd
      LEFT JOIN kublai_material m ON m.id = pd."materialId"
      LEFT JOIN kublai_size s ON s.id = pd."sizeId"
      LEFT JOIN kublai_unit u ON u.id = s."unitId"
    )
    UPDATE kublai_part_definition pd
    SET "displayName" = rebuilt.next_display_name
    FROM rebuilt
    WHERE pd.id = rebuilt.id
      AND rebuilt.next_display_name IS NOT NULL
      AND pd."displayName" IS DISTINCT FROM rebuilt.next_display_name
    RETURNING pd.id
  `);

  console.log(
    JSON.stringify(
      {
        updatedCount: result.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("Failed to rebuild part names", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
