import { sql } from "drizzle-orm";
import type { db } from "~/server/db";
import {
  CATALOGUE_HIDDEN_SCOPE,
  catalogueHiddenSettingsSchema,
  sameCriteria,
  type CatalogueHideCriteria,
  type CatalogueHideRule,
} from "~/lib/catalogue-hidden";

/** The company's hide rules live in the shared jsonb settings store, under
 * their own scope, so they need no table of their own. */
export async function readHiddenPartRules(database: typeof db, organizationId: string) {
  const [row] = await database.execute<{ settings: unknown }>(
    sql`select settings from kublai_material_sort_preference where organization_id=${organizationId}::uuid and scope=${CATALOGUE_HIDDEN_SCOPE}`,
  );
  return catalogueHiddenSettingsSchema.safeParse(row?.settings).data?.rules ?? [];
}

/** Adds or removes one rule under a row lock, so two people hiding parts at
 * once both keep their rules. */
export async function changeHiddenPartRules(
  database: typeof db,
  organizationId: string,
  change: (rules: CatalogueHideRule[]) => CatalogueHideRule[],
) {
  return database.transaction(async (tx) => {
    await tx.execute(
      sql`insert into kublai_material_sort_preference (organization_id, scope, settings, custom) values (${organizationId}::uuid, ${CATALOGUE_HIDDEN_SCOPE}, ${JSON.stringify({ rules: [] })}::jsonb, false) on conflict (organization_id, scope) do nothing`,
    );
    const [row] = await tx.execute<{ settings: unknown }>(
      sql`select settings from kublai_material_sort_preference where organization_id=${organizationId}::uuid and scope=${CATALOGUE_HIDDEN_SCOPE} for update`,
    );
    const current = catalogueHiddenSettingsSchema.safeParse(row?.settings).data?.rules ?? [];
    const rules = catalogueHiddenSettingsSchema.parse({ rules: change(current) }).rules;
    await tx.execute(
      sql`update kublai_material_sort_preference set settings=${JSON.stringify({ rules })}::jsonb where organization_id=${organizationId}::uuid and scope=${CATALOGUE_HIDDEN_SCOPE}`,
    );
    return rules;
  });
}

export const addHideRule = (criteria: CatalogueHideCriteria) => (rules: CatalogueHideRule[]) =>
  rules.some((rule) => sameCriteria(rule, criteria))
    ? rules
    : [...rules, { ...criteria, id: crypto.randomUUID() }];

export const removeHideRule = (id: string) => (rules: CatalogueHideRule[]) =>
  rules.filter((rule) => rule.id !== id);
