-- Do not backfill completion: every existing account receives the tutorial once.
ALTER TABLE kublai_user
  ADD COLUMN IF NOT EXISTS "tutorialCompletedAt" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "tutorialOutcome" varchar(20);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_tutorial_state_check') THEN
    ALTER TABLE kublai_user ADD CONSTRAINT user_tutorial_state_check CHECK (
      ("tutorialCompletedAt" IS NULL AND "tutorialOutcome" IS NULL)
      OR ("tutorialCompletedAt" IS NOT NULL AND "tutorialOutcome" IS NOT NULL
        AND "tutorialOutcome" IN ('completed', 'skipped'))
    );
  END IF;
END $$;
