DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_mutation'
      AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_mutation" RENAME COLUMN "organization_id" TO "organizationId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_mutation'
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_mutation" RENAME COLUMN "user_id" TO "userId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_mutation'
      AND column_name = 'material_list_id'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_mutation" RENAME COLUMN "material_list_id" TO "materialListId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_mutation'
      AND column_name = 'client_mutation_id'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_mutation" RENAME COLUMN "client_mutation_id" TO "clientMutationId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_mutation'
      AND column_name = 'mutation_type'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_mutation" RENAME COLUMN "mutation_type" TO "mutationType";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_mutation'
      AND column_name = 'server_item_id'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_mutation" RENAME COLUMN "server_item_id" TO "serverItemId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_mutation'
      AND column_name = 'client_item_id'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_mutation" RENAME COLUMN "client_item_id" TO "clientItemId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_mutation'
      AND column_name = 'applied_at'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_mutation" RENAME COLUMN "applied_at" TO "appliedAt";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_tombstone'
      AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_tombstone" RENAME COLUMN "organization_id" TO "organizationId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_tombstone'
      AND column_name = 'material_list_id'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_tombstone" RENAME COLUMN "material_list_id" TO "materialListId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_tombstone'
      AND column_name = 'entity_type'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_tombstone" RENAME COLUMN "entity_type" TO "entityType";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_tombstone'
      AND column_name = 'entity_id'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_tombstone" RENAME COLUMN "entity_id" TO "entityId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kublai_material_list_sync_tombstone'
      AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE "kublai_material_list_sync_tombstone" RENAME COLUMN "deleted_at" TO "deletedAt";
  END IF;
END $$;
