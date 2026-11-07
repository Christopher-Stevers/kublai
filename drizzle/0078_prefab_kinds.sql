ALTER TABLE "kublai_material_prefab" ADD COLUMN IF NOT EXISTS "kind" varchar(16) NOT NULL DEFAULT 'materials';
-- Existing all-tool prefabs belong in the tool library. Empty and mixed legacy
-- prefabs stay material prefabs; no contents are discarded.
UPDATE "kublai_material_prefab" f SET kind = 'tools'
WHERE kind = 'materials'
AND EXISTS (SELECT 1 FROM "kublai_material_prefab_item" i WHERE i."prefabId" = f.id)
AND NOT EXISTS (
 SELECT 1 FROM "kublai_material_prefab_item" i
 JOIN "kublai_part_definition" p ON p.id = i."partDefinitionId"
 LEFT JOIN "kublai_catalog" c ON c.id = p."catalogId"
 WHERE i."prefabId" = f.id AND c.kind IS DISTINCT FROM 'assets'
);
