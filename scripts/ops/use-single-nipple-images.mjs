import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import postgres from "postgres";
const apply = process.argv.includes("--apply");
const overrides = JSON.parse(
  fs.readFileSync("data/catalogue/cb-steel-nipple-image-overrides.json"),
);
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const result = await sql.begin(apply ? "" : "read only", async (tx) => {
    const [job] =
      await tx`select "organizationId" org from kublai_job where id='0391aed4-7773-47ec-9141-09df373ec008'`;
    if (!job?.org) throw Error("Alma organization missing");
    const rows =
      await tx`select id,"displayName","imageUrl","imageAssetId","piecesPerPack" from kublai_part_definition where "organizationId"=${job.org} and "imageUrl" in ${tx(Object.values(overrides).map((i) => i.previousUrl))}`;
    if (
      rows.some(
        (r) =>
          !/\bnipple\b/i.test(r.displayName) ||
          /\b(pack|set|assortment)\b/i.test(r.displayName) ||
          r.piecesPerPack > 1,
      )
    )
      throw Error("Unexpected set or non-nipple in replacements");
    for (const i of Object.values(overrides))
      if (
        createHash("sha256").update(fs.readFileSync(i.path)).digest("hex") !==
        i.sha256
      )
        throw Error("Image checksum mismatch");
    if (!apply) return { wouldUpdate: rows.length };
    fs.mkdirSync("state-backups", { recursive: true });
    const backup = `state-backups/single-nipple-images-${Date.now()}.json`;
    fs.writeFileSync(
      backup,
      JSON.stringify({ organizationId: job.org, parts: rows }, null, 2),
    );
    let updated = 0;
    for (const [key, i] of Object.entries(overrides)) {
      let [asset] =
        await tx`select id,url from kublai_photo_asset where "organizationId"=${job.org} and checksum=${i.sha256} limit 1`;
      if (!asset)
        [asset] =
          await tx`insert into kublai_photo_asset ${tx({ id: randomUUID(), organizationId: job.org, storageKey: path.basename(i.path), url: i.url, originalFilename: `CB-${key}-single-nipple.webp`, contentType: "image/webp", byteSize: i.byteSize, checksum: i.sha256, sourceUrl: i.sourceUrl, notes: i.notes, createdAt: new Date(), updatedAt: new Date() })} returning id,url`;
      const ids = rows
        .filter((r) => r.imageUrl === i.previousUrl)
        .map((r) => r.id);
      if (ids.length) {
        const changed =
          await tx`update kublai_part_definition set "imageUrl"=${asset.url},"imageAssetId"=${asset.id} where "organizationId"=${job.org} and id in ${tx(ids)} returning id`;
        updated += changed.length;
      }
    }
    if (updated !== rows.length) throw Error("Update count mismatch");
    return { updated, sharedImages: 2, backup };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}
