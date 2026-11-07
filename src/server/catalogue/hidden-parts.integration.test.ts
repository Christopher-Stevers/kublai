// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { addHideRule, changeHiddenPartRules, readHiddenPartRules, removeHideRule } from "./hidden-parts";
import { readMaterialSortPreferences } from "~/server/material-sort-preferences";
import { defaultMaterialSortSettings } from "~/lib/material-sort-preferences";
import type { db as appDb } from "~/server/db";

const socket = process.env.CATALOGUE_TEST_SOCKET;
const conn = postgres({ host: socket ?? "/tmp/no-catalogue-db", port: 55462, database: "catalogue_integration", max: 4 });
const db = drizzle(conn) as unknown as typeof appDb;
const org = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe.skipIf(!socket)("hidden part rules in the settings store", () => {
  beforeAll(async () => {
    await db.execute(sql`create table kublai_material_sort_preference (organization_id uuid not null, scope varchar(255) not null, settings jsonb not null, custom boolean not null default false, primary key (organization_id, scope))`);
  });
  afterAll(async () => { await conn.end(); });

  it("keeps every rule when people hide parts at the same time, per company", async () => {
    expect(await readHiddenPartRules(db, org)).toEqual([]);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => changeHiddenPartRules(db, org, addHideRule({ materialId: uuid(100 + i) }))),
    );
    const rules = await readHiddenPartRules(db, org);
    expect(rules.map((rule) => rule.materialId).sort()).toEqual(Array.from({ length: 8 }, (_, i) => uuid(100 + i)));
    expect(await readHiddenPartRules(db, other)).toEqual([]);
    await changeHiddenPartRules(db, org, removeHideRule(rules[0]!.id));
    expect(await readHiddenPartRules(db, org)).toHaveLength(7);
  });

  it("leaves sorting preferences alone", async () => {
    const sorting = await readMaterialSortPreferences(db, org, "crew");
    expect(sorting).toEqual({ shared: defaultMaterialSortSettings, personal: null, custom: false, initialized: false });
  });
});
