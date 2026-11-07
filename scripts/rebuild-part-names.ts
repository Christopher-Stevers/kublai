import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "../src/server/db";

async function main() {
  const result = await db.execute(sql`
    WITH size_display AS (
      SELECT
        s.id,
        CASE
          WHEN u.code IN ('in', 'ft', 'yd') THEN
            trim(
              concat_ws(
                ' ',
                CASE
                  WHEN floor(s.nominal::numeric) > 0 THEN floor(s.nominal::numeric)::text
                  ELSE NULL
                END,
                CASE round(((s.nominal::numeric - floor(s.nominal::numeric)) * 16), 0)::int
                  WHEN 0 THEN NULL
                  WHEN 1 THEN '1/16'
                  WHEN 2 THEN '1/8'
                  WHEN 3 THEN '3/16'
                  WHEN 4 THEN '1/4'
                  WHEN 5 THEN '5/16'
                  WHEN 6 THEN '3/8'
                  WHEN 7 THEN '7/16'
                  WHEN 8 THEN '1/2'
                  WHEN 9 THEN '9/16'
                  WHEN 10 THEN '5/8'
                  WHEN 11 THEN '11/16'
                  WHEN 12 THEN '3/4'
                  WHEN 13 THEN '13/16'
                  WHEN 14 THEN '7/8'
                  WHEN 15 THEN '15/16'
                  WHEN 16 THEN '1'
                  ELSE NULL
                END,
                u.code
              )
            )
          ELSE trim(concat_ws(' ', trim(to_char(s.nominal::numeric, 'FM999999999.######')), u.code))
        END AS display_size
      FROM kublai_size s
      LEFT JOIN kublai_unit u ON u.id = s."unitId"
    ),
    rebuilt AS (
      SELECT
        pd.id,
        NULLIF(
          trim(
            concat_ws(
              ' ',
              sd.display_size,
              m.name,
              pd.description
            )
          ),
          ''
        ) AS next_display_name
      FROM kublai_part_definition pd
      LEFT JOIN kublai_material m ON m.id = pd."materialId"
      LEFT JOIN size_display sd ON sd.id = pd."sizeId"
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
