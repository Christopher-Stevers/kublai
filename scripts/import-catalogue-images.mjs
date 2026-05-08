import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import "dotenv/config";
import postgres from "postgres";
import sharp from "sharp";

const uploadDir = path.join(
  process.cwd(),
  "public",
  "images",
  "catalog",
  "uploads",
);
const publicPrefix = "/api/catalogue/images";

const sources = {
  ballValve: {
    title: "Brass-Ball-Valve MF Butterfly 12592-360x480 (4999932531).jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/d/da/Brass-Ball-Valve_MF_Butterfly_12592-360x480_%284999932531%29.jpg",
    filename: "part-9fbb37b8-051d-47e1-9079-b24d12aa60b9.webp",
  },
  checkValve: {
    title: "Check Valve.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Check_Valve.jpg/960px-Check_Valve.jpg",
    filename: "part-acb74210-52fa-411c-bacc-9e6ef4a7d02d.webp",
  },
  gateValve: {
    title: "Bellow Seal Gate Valve.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Bellow_Seal_Gate_Valve.jpg/960px-Bellow_Seal_Gate_Valve.jpg",
    filename: "part-848fec48-a967-429d-9003-0a5825a78895.webp",
  },
  copperPipe: {
    title: "Copper pipe without num.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/b/b5/Copper_pipe_without_num.jpg",
    filename: "part-ea5d003a-3662-4f7b-893b-a9fbdc154fea.webp",
  },
  pexPipe: {
    title: "PEX piping bending in a basement.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/7/7e/PEX_piping_bending_in_a_basement.jpg",
    filename: "part-e5168582-93e8-44ce-b065-c4ebdbdc7e97.webp",
  },
  pvcPipe: {
    title: "1 inch PVC Valve and pipe-IMG 1061.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/1_inch_PVC_Valve_and_pipe-IMG_1061.jpg/960px-1_inch_PVC_Valve_and_pipe-IMG_1061.jpg",
    filename: "part-cbca075d-f879-4c2e-9d2f-2be5e004bbcd.webp",
  },
  copperFittings: {
    title: "Kupferfittings 4062.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Kupferfittings_4062.jpg/960px-Kupferfittings_4062.jpg",
    filename: "part-6280bbe1-9aa6-4676-81c5-c7a734aef7c0.webp",
  },
  pexFittings: {
    title: "PexMall-Brass-Crimp-Fittings-For-PEX.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/PexMall-Brass-Crimp-Fittings-For-PEX.jpg/960px-PexMall-Brass-Crimp-Fittings-For-PEX.jpg",
  },
  pvcFittings: {
    title: "PVC plumbing fittings in Awka.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/PVC_plumbing_fittings_in_Awka.jpg/960px-PVC_plumbing_fittings_in_Awka.jpg",
  },
  reducingTee: {
    title: "Tés de plomberie.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/T%C3%A9s_de_plomberie.jpg/960px-T%C3%A9s_de_plomberie.jpg",
  },
  bathroomFaucet: {
    title: "Chicago Faucet Co faucet.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Chicago_Faucet_Co_faucet.jpg/960px-Chicago_Faucet_Co_faucet.jpg",
  },
  kitchenFaucet: {
    title: "Kitchen Faucet 1.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Kitchen_Faucet_1.jpg/960px-Kitchen_Faucet_1.jpg",
  },
  bathroomSink: {
    title: "Bathroom sink, New Orleans, December 2024.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/Bathroom_sink%2C_New_Orleans%2C_December_2024.jpg/960px-Bathroom_sink%2C_New_Orleans%2C_December_2024.jpg",
  },
  kitchenSink: {
    title: "Custom Stainless Steel Sink by Havens.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Custom_Stainless_Steel_Sink_by_Havens.jpg/960px-Custom_Stainless_Steel_Sink_by_Havens.jpg",
  },
  toilet: {
    title: "Premier Inn bathroom toilet, Horsham, West Sussex.jpg",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Premier_Inn_bathroom_toilet%2C_Horsham%2C_West_Sussex.jpg/960px-Premier_Inn_bathroom_toilet%2C_Horsham%2C_West_Sussex.jpg",
  },
};

function sourceKeyForPart(name) {
  const lower = name.toLowerCase();
  if (lower.includes("ball valve")) return "ballValve";
  if (lower.includes("check valve")) return "checkValve";
  if (lower.includes("gate valve")) return "gateValve";
  if (lower.includes("kitchen faucet")) return "kitchenFaucet";
  if (lower.includes("bathroom faucet")) return "bathroomFaucet";
  if (lower.includes("kitchen sink")) return "kitchenSink";
  if (lower.includes("bathroom sink")) return "bathroomSink";
  if (lower === "toilet") return "toilet";
  if (lower.includes("reducing tee")) return "reducingTee";
  if (lower.includes("copper") && lower.includes("pipe")) return "copperPipe";
  if (lower.includes("pex") && lower.includes("pipe")) return "pexPipe";
  if (lower.includes("pvc") && lower.includes("pipe")) return "pvcPipe";
  if (lower.includes("copper")) return "copperFittings";
  if (lower.includes("pex")) return "pexFittings";
  if (lower.includes("pvc")) return "pvcFittings";
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadImage(url) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, {
      headers: { "User-Agent": "ForemenHQ catalogue image importer" },
    });
    if (response.ok) return Buffer.from(await response.arrayBuffer());

    if (response.status === 429 && attempt < 4) {
      await delay(15_000 * attempt);
      continue;
    }

    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }
  throw new Error(`Failed to download ${url}`);
}

async function main() {
  await mkdir(uploadDir, { recursive: true });

  const downloaded = new Map();
  for (const [key, source] of Object.entries(sources)) {
    if (source.filename) {
      const filename = source.filename;
      downloaded.set(key, {
        ...source,
        filename,
        imageUrl: `${publicPrefix}/${filename}`,
      });
      console.log(`${key}: ${filename} (cached)`);
      continue;
    }

    await delay(8_000);
    const input = await downloadImage(source.url);
    const filename = `part-${randomUUID()}.webp`;
    const output = await sharp(input)
      .rotate()
      .resize({
        width: 1200,
        height: 1200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 78 })
      .toBuffer();
    await writeFile(path.join(uploadDir, filename), output);
    downloaded.set(key, {
      ...source,
      filename,
      imageUrl: `${publicPrefix}/${filename}`,
    });
    console.log(`${key}: ${filename}`);
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const parts = await sql`
    select id, "displayName"
    from kublai_part_definition
    where "isActive" = true and ("imageUrl" is null or "imageUrl" = '')
    order by "displayName"`;

  const updates = [];
  for (const part of parts) {
    const key = sourceKeyForPart(part.displayName);
    const image = key ? downloaded.get(key) : null;
    if (!image) {
      console.warn(`No source match for ${part.displayName}`);
      continue;
    }
    await sql`
      update kublai_part_definition
      set "imageUrl" = ${image.imageUrl}
      where id = ${part.id}`;
    updates.push({
      id: part.id,
      name: part.displayName,
      sourceKey: key,
      imageUrl: image.imageUrl,
    });
  }

  await sql.end();

  const sourceRows = updates
    .map((update) => {
      const source = downloaded.get(update.sourceKey);
      return `| ${update.name} | ${update.imageUrl} | Wikimedia Commons: ${source.title} | ${source.url} |`;
    })
    .join("\n");

  await writeFile(
    path.join(process.cwd(), "catalogue-image-sources.md"),
    `# Catalogue Image Sources\n\nImported ${updates.length} catalogue images on ${new Date().toISOString()}.\n\nImages were downloaded from Wikimedia Commons/public media pages, converted to local WebP files, and stored under \`public/images/catalog/uploads\`.\n\n| Part | Local URL | Source | Source URL |\n|---|---|---|---|\n${sourceRows}\n`,
  );

  console.log(`Updated ${updates.length} part definitions.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
