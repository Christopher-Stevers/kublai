#!/usr/bin/env node
// @ts-nocheck -- organization-scoped catalogue maintenance with runtime checks.
require("dotenv/config");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");

const apply = process.argv.includes("--apply");
const provenance = "Listed in manufacturer catalogue";
const imports = [
  ["viega-megapressg-20261103", "data/catalogue/megapressg.json"],
  ["viega-megapress-stainless-20261104", "data/catalogue/megapress-stainless.json"],
];
const expectedCounts = {
  "Carbon Steel Press": 118,
  "Copper Press": 153,
  "MegaPressG (Natural Gas)": 207,
  "MegaPress Stainless 304 (FKM)": 159,
  "MegaPress Stainless 316 (EPDM)": 163,
  "MegaPress Stainless 316 (FKM)": 170,
};
const manifests = new Map();
const hashes = {};
for (const [source, file] of imports) {
  const bytes = fs.readFileSync(file);
  hashes[file] = createHash("sha256").update(bytes).digest("hex");
  for (const row of JSON.parse(bytes).rows) {
    const key = source + ":" + row.sku;
    assert(!manifests.has(key), "Duplicate article " + key);
    assert(row.displayName.length <= 255 && row.description);
    assert(!row.displayName.includes(row.sku));
    assert(!row.displayName.includes(row.model));
    assert(!row.description.includes("Model "));
    assert(!JSON.stringify(row).includes(provenance));
    assert(row.aliases.includes("Model " + row.model));
    assert(row.aliases.includes("Manufacturer part number " + row.sku));
    assert(row.aliases.some((a) => a.startsWith("Connections: ")));
    assert(row.aliases.every((a) => a.length <= 255));
    manifests.set(key, row);
  }
}
assert.equal(manifests.size, 699);
assert.equal(new Set([...manifests.values()].map((r) => r.displayName.toLowerCase())).size, 699);

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10 });
  try {
    const result = await sql.begin(apply ? "" : "read only", async (tx) => {
      const users = await tx`select "organizationId" from kublai_user where lower(email)=lower(${process.env.PRESS_CATALOGUE_USER_EMAIL || "tim.j.saunders@gmail.com"})`;
      assert.equal(users.length, 1, "Expected one organization account");
      const org = users[0].organizationId;
      assert(org);
      const suppliers = await tx`select id from kublai_supplier where "organizationId"=${org} and lower(name)='next'`;
      assert.equal(suppliers.length, 1, "Expected one Next supplier");
      const supplierId = suppliers[0].id;
      if (apply) await tx`select pg_advisory_xact_lock(hashtext(${"press-next-cleanup:" + org}))`;
      const parts = await tx`select p.*, m.name as material from kublai_part_definition p join kublai_material m on m.id=p."materialId" join kublai_category c on c.id=p."categoryId" where p."organizationId"=${org} and c.name='Fitting' and m."groupPath" @> '["Press"]'::jsonb order by p.id ${apply ? tx`for update of p` : tx``}`;
      const counts = {};
      for (const p of parts) counts[p.material] = (counts[p.material] || 0) + 1;
      assert.deepEqual(counts, expectedCounts, "Press inventory changed; review scope before applying");
      const ids = parts.map((p) => p.id);
      const attributes = await tx`select * from kublai_part_attribute where "partDefinitionId" in ${tx(ids)} order by id`;
      const aliases = await tx`select * from kublai_part_synonym where "partDefinitionId" in ${tx(ids)} order by id`;
      const listings = await tx`select * from kublai_supplier_part where "partDefinitionId" in ${tx(ids)} order by id ${apply ? tx`for update` : tx``}`;
      const [revisionBefore] = await tx`select revision from kublai_sync_revision where kind='catalogue' and scope=${org}`;
      const attributesFor = (id) => Object.fromEntries(attributes.filter((a) => a.partDefinitionId === id).map((a) => [a.key, a.valueText]));
      const rowsById = new Map();
      const changes = [], newAliases = [], newListings = [], preferenceChanges = [];
      for (const part of parts) {
        const attrs = attributesFor(part.id);
        const row = manifests.get(attrs.source_import + ":" + attrs.manufacturer_part_number);
        if (row) {
          assert.equal(part.material, row.material);
          assert.equal(part.sizeLabel, row.sizeLabel);
          assert.equal(attrs.manufacturer_model, row.model);
          rowsById.set(part.id, row);
          if (part.displayName !== row.displayName || part.description !== row.description)
            changes.push({ id: part.id, displayName: row.displayName, description: row.description });
          const seen = new Set(aliases.filter((a) => a.partDefinitionId === part.id).map((a) => a.synonym.toLowerCase()));
          for (const alias of row.aliases) if (!seen.has(alias.toLowerCase())) {
            newAliases.push({ id: randomUUID(), partDefinitionId: part.id, synonym: alias });
            seen.add(alias.toLowerCase());
          }
        } else assert(["Carbon Steel Press", "Copper Press"].includes(part.material), "Unmapped MegaPress part " + part.id);
        const partListings = listings.filter((l) => l.partDefinitionId === part.id);
        assert(partListings.every((l) => l.organizationId === org));
        const next = partListings.filter((l) => l.supplierId === supplierId);
        assert(next.length <= 1, "Multiple Next listings require review: " + part.id);
        if (!next.length) newListings.push({ id: randomUUID(), organizationId: org, supplierId, partDefinitionId: part.id, supplierSku: null, supplierName: null, lastKnownUnitCost: null, packSize: null, packUomId: null, currency: "CAD", isPreferred: true, createdAt: new Date() });
        for (const listing of partListings) if (listing.isPreferred !== (listing.supplierId === supplierId))
          preferenceChanges.push({ id: listing.id, isPreferred: listing.supplierId === supplierId });
      }
      assert.equal(rowsById.size, 699, "Missing imported articles");
      const removeAliases = aliases.filter((a) => a.synonym.includes(provenance));
      // Do not discard useful text if unexpected mixed-content aliases exist.
      assert(removeAliases.every((a) => a.synonym.replace(/\.$/, "") === provenance));
      const removeAttributes = attributes.filter((a) => a.key === "availability" && a.valueText?.replace(/\.$/, "") === provenance);
      const summary = { mode: apply ? "apply" : "dry-run", pressFittings: parts.length, labelsToClean: changes.length, aliasesToAdd: newAliases.length, provenanceAliasesToRemove: removeAliases.length, provenanceAttributesToRemove: removeAttributes.length, nextListingsToAdd: newListings.length, preferencesToChange: preferenceChanges.length, revisionBefore: revisionBefore?.revision };
      const mutationCount = changes.length + newAliases.length + removeAliases.length + removeAttributes.length + newListings.length + preferenceChanges.length;
      if (!apply) return summary;
      let backup;
      if (mutationCount) {
        fs.mkdirSync("state-backups", { recursive: true });
        backup = `state-backups/press-next-cleanup-${Date.now()}.json`;
        fs.writeFileSync(backup, JSON.stringify({ org, supplierId, hashes, parts, attributes, aliases, listings, summary, plannedNewAliasIds: newAliases.map((a) => a.id), plannedNewListingIds: newListings.map((l) => l.id) }, null, 2), { mode: 0o600, flag: "wx" });
        for (const row of changes)
          await tx`update kublai_part_definition set "displayName"=${row.displayName}, description=${row.description} where id=${row.id} and "organizationId"=${org}`;
        if (removeAliases.length) await tx`delete from kublai_part_synonym where id in ${tx(removeAliases.map((a) => a.id))}`;
        if (removeAttributes.length) await tx`delete from kublai_part_attribute where id in ${tx(removeAttributes.map((a) => a.id))}`;
        for (let i = 0; i < newAliases.length; i += 500)
          await tx`insert into kublai_part_synonym ${tx(newAliases.slice(i, i + 500))}`;
        for (const row of preferenceChanges)
          await tx`update kublai_supplier_part set "isPreferred"=${row.isPreferred} where id=${row.id} and "organizationId"=${org}`;
        for (let i = 0; i < newListings.length; i += 500)
          await tx`insert into kublai_supplier_part ${tx(newListings.slice(i, i + 500))}`;
      }
      const afterParts = await tx`select * from kublai_part_definition where id in ${tx(ids)} order by id`;
      const afterAliases = await tx`select * from kublai_part_synonym where "partDefinitionId" in ${tx(ids)} order by id`;
      const afterAttributes = await tx`select * from kublai_part_attribute where "partDefinitionId" in ${tx(ids)} order by id`;
      const afterListings = await tx`select * from kublai_supplier_part where "partDefinitionId" in ${tx(ids)} order by id`;
      for (const before of parts) {
        const { material, ...original } = before;
        const row = rowsById.get(before.id);
        const actual = afterParts.find((p) => p.id === before.id);
        assert.deepEqual(actual, { ...original, ...(row ? { displayName: row.displayName, description: row.description } : {}) }, "Unexpected part change " + before.id);
        const preferred = afterListings.filter((l) => l.partDefinitionId === before.id && l.isPreferred);
        assert.equal(preferred.length, 1);
        assert.equal(preferred[0].supplierId, supplierId);
        if (row) {
          const present = new Set(afterAliases.filter((a) => a.partDefinitionId === before.id).map((a) => a.synonym.toLowerCase()));
          assert(row.aliases.every((a) => present.has(a.toLowerCase())), "Missing searchable alias " + row.sku);
        }
      }
      for (const old of listings) {
        const now = afterListings.find((l) => l.id === old.id);
        assert.deepEqual(now, { ...old, isPreferred: old.supplierId === supplierId }, "Existing price/listing changed");
      }
      assert.equal(afterListings.length, listings.length + newListings.length);
      for (const row of afterListings.filter((l) => !listings.some((old) => old.id === l.id))) {
        assert.equal(row.supplierSku, null);
        assert.equal(row.lastKnownUnitCost, null);
      }
      assert.deepEqual([...afterAttributes], attributes.filter((a) => !removeAttributes.some((r) => r.id === a.id)));
      for (const old of aliases.filter((a) => !removeAliases.some((r) => r.id === a.id)))
        assert.deepEqual(afterAliases.find((a) => a.id === old.id), old);
      assert.equal(afterAliases.length, aliases.length + newAliases.length - removeAliases.length);
      assert(!afterAliases.some((a) => a.synonym.includes(provenance)));
      assert(!afterParts.some((p) => p.displayName.includes(provenance) || p.description?.includes(provenance)));
      const [revisionAfter] = await tx`select revision from kublai_sync_revision where kind='catalogue' and scope=${org}`;
      return { ...summary, verified: true, revisionAfter: revisionAfter?.revision, backup };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { await sql.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
