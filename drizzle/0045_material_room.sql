-- Room attribution stays optional and survives deletion of the room as a blank value.
ALTER TABLE kublai_material_list ADD COLUMN IF NOT EXISTS "roomId" uuid;
ALTER TABLE kublai_quote_item ADD COLUMN IF NOT EXISTS "roomId" uuid;
ALTER TABLE kublai_order_item ADD COLUMN IF NOT EXISTS "roomId" uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_list_room_fk') THEN
    ALTER TABLE kublai_material_list ADD CONSTRAINT material_list_room_fk
      FOREIGN KEY ("roomId") REFERENCES kublai_job_room(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_item_room_fk') THEN
    ALTER TABLE kublai_quote_item ADD CONSTRAINT quote_item_room_fk
      FOREIGN KEY ("roomId") REFERENCES kublai_job_room(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_room_fk') THEN
    ALTER TABLE kublai_order_item ADD CONSTRAINT order_item_room_fk
      FOREIGN KEY ("roomId") REFERENCES kublai_job_room(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS material_list_room_idx ON kublai_material_list ("roomId");
CREATE INDEX IF NOT EXISTS quote_item_room_idx ON kublai_quote_item ("roomId");
CREATE INDEX IF NOT EXISTS order_item_room_idx ON kublai_order_item ("roomId");

-- A renamed room must invalidate material-list snapshots that include its current name.
-- Shape/review/notes changes do not affect those snapshots.
DROP TRIGGER IF EXISTS material_room_name_revision ON kublai_job_room;
CREATE TRIGGER material_room_name_revision
  AFTER UPDATE OF name ON kublai_job_room FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION kublai_bump_sync_revision('material-lists');
