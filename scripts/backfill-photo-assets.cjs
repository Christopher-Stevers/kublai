const { createHash } = require("node:crypto");
const { readdir, readFile, stat } = require("node:fs/promises");
const path = require("node:path");
const postgres = require("postgres");

const ROOT = path.resolve(__dirname, "..");
const UPLOAD_DIR = path.join(ROOT, "public", "images", "catalog", "uploads");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const organizations = await sql`
    select "organizationId", count(*)::int as "partCount"
    from kublai_part_definition
    group by "organizationId"
    order by "partCount" desc
  `;
  const orphanOwner = organizations[0] ?? null;
  const files = (await readdir(UPLOAD_DIR)).filter((name) =>
    /^part-[0-9a-f-]+\.webp$/i.test(name),
  );

  let createdOrUpdated = 0;
  let skippedUnassigned = 0;

  for (const filename of files) {
    const url = `/api/catalogue/images/${filename}`;
    const references = await sql`
      select distinct "organizationId"
      from kublai_part_definition
      where "imageUrl" = ${url}
    `;
    const owners =
      references.length > 0 ? references : orphanOwner ? [orphanOwner] : [];

    if (owners.length === 0) {
      skippedUnassigned += 1;
      continue;
    }

    const filePath = path.join(UPLOAD_DIR, filename);
    const [buffer, fileStats] = await Promise.all([
      readFile(filePath),
      stat(filePath),
    ]);
    const checksum = createHash("sha256").update(buffer).digest("hex");

    for (const owner of owners) {
      await sql`
        insert into kublai_photo_asset (
          "organizationId",
          "storageKey",
          "url",
          "originalFilename",
          "contentType",
          "byteSize",
          "checksum",
          "createdAt",
          "updatedAt"
        ) values (
          ${owner.organizationId},
          ${filename},
          ${url},
          ${filename},
          'image/webp',
          ${fileStats.size},
          ${checksum},
          ${fileStats.mtime},
          now()
        )
        on conflict ("organizationId", "url") do update set
          "storageKey" = excluded."storageKey",
          "byteSize" = excluded."byteSize",
          "checksum" = excluded."checksum",
          "updatedAt" = now()
      `;
      createdOrUpdated += 1;
    }
  }

  await sql`
    update kublai_part_definition as part
    set "imageAssetId" = asset.id
    from kublai_photo_asset as asset
    where part."organizationId" = asset."organizationId"
      and part."imageUrl" = asset.url
      and part."imageAssetId" is distinct from asset.id
  `;

  const [assetCount] =
    await sql`select count(*)::int as count from kublai_photo_asset`;
  console.log(
    JSON.stringify({
      files: files.length,
      createdOrUpdated,
      skippedUnassigned,
      assetCount: assetCount?.count ?? 0,
    }),
  );
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
