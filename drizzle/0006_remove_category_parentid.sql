-- Migration: Remove parentId from categories table
-- This migration removes the parentId field and related constraints/indexes
-- Run the data migration script (migrate-categories-to-root-only.ts) BEFORE running this migration

-- Remove unique constraint that includes parentId
ALTER TABLE kublai_category DROP CONSTRAINT IF EXISTS category_org_parent_name_uniq;

-- Remove index on parentId
DROP INDEX IF EXISTS category_parent_idx;

-- Remove parentId column
ALTER TABLE kublai_category DROP COLUMN IF EXISTS parent_id;

-- Add new unique constraint on (organizationId, name)
ALTER TABLE kublai_category ADD CONSTRAINT category_org_name_uniq UNIQUE (organization_id, name);
