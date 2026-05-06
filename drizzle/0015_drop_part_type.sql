ALTER TABLE "kublai_part_definition" DROP COLUMN IF EXISTS "partTypeId";
ALTER TABLE "kublai_quote_item" DROP COLUMN IF EXISTS "oneOffPartType";
DROP TABLE IF EXISTS "kublai_part_type";
