// Extracted, unaltered manufacturer family photos; one asset per family/assortment.
import fs from "node:fs";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const file = "data/catalogue/cb-steel-nipples.json";
const data = JSON.parse(fs.readFileSync(file));
for (const key of ["PN", "XHN", "SSPN"])
  execFileSync("pdfimages", [
    "-png",
    `.tmp/cb-nipples-20261019/${key}.pdf`,
    `.tmp/cb-nipples-20261019/${key.toLowerCase()}`,
  ]);
const mappings = {
  black: ["pn-004.png", "PN", 1],
  galvanized: ["pn-034.png", "PN", 7],
  stainless: ["sspn-013.png", "SSPN", 3],
  "left-right": ["xhn-005.png", "XHN", 3],
  "one-end": ["pn-047.png", "PN", 11],
  "single-run": ["pn-028.png", "PN", 6],
  "pack-5": ["pn-029.png", "PN", 6],
  "pack-4": ["pn-030.png", "PN", 6],
  "pack-10": ["pn-031.png", "PN", 6],
  "pack-9": ["pn-032.png", "PN", 7],
  "pack-8": ["pn-033.png", "PN", 7],
};
data.images = {};
for (const [key, [source, publication, page]] of Object.entries(mappings)) {
  const buf = await sharp(".tmp/cb-nipples-20261019/" + source)
    .resize({
      width: 1000,
      height: 1000,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer();
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const path = "public/images/catalog/uploads/part-" + sha256 + ".webp";
  fs.writeFileSync(path, buf);
  data.images[key] = {
    path,
    url: "/api/catalogue/images/part-" + sha256 + ".webp",
    sha256,
    byteSize: buf.length,
    publication,
    page,
    sourceUrl: data.publications.find((p) => p.number === publication).url,
  };
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
console.log({
  images: Object.keys(data.images).length,
  bytes: Object.values(data.images).reduce((n, i) => n + i.byteSize, 0),
});
