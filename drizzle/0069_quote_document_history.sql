DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'kublai_quote' AND column_name = 'generatedAt'
  ) THEN
    ALTER TABLE "kublai_quote" ADD COLUMN "generatedAt" timestamp with time zone;
    -- Preserve existing history once. New material-list backing rows remain null.
    UPDATE "kublai_quote" SET "generatedAt" = "createdAt";
  END IF;
END $$;
