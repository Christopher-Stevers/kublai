import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
const root = path.resolve("perf/drawings/private"),
  corpus = JSON.parse(await readFile(path.join(root, "corpus.json"), "utf8")),
  results = [];
for (const sample of corpus.samples) {
  try {
    const json = JSON.parse(
      execFileSync(
        "qpdf",
        [
          "--json=2",
          "--json-key=qpdf",
          "--json-stream-data=inline",
          "--decode-level=none",
          sample.file,
        ],
        { maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
      ),
    );
    const objects = json.qpdf[1],
      images = Object.values(objects).filter(
        (o) => o.stream?.dict?.["/Subtype"] === "/Image",
      );
    const fonts = new Set();
    for (const object of Object.values(objects)) {
      const value = object.value ?? object.stream?.dict;
      for (const key of ["/FontFile", "/FontFile2", "/FontFile3"])
        if (value?.[key]) fonts.add("obj:" + value[key]);
    }
    const imageStreamBytes = images.reduce(
      (n, image) => n + Buffer.from(image.stream.data ?? "", "base64").length,
      0,
    );
    let embeddedFontStreamBytes = 0;
    for (const id of fonts) {
      const stream = objects[id]?.stream;
      if (stream?.data)
        embeddedFontStreamBytes += Buffer.from(stream.data, "base64").length;
    }
    results.push({
      hash: sample.hash,
      originalEncodedImageStreams: images.length,
      originalEncodedImageStreamBytes: imageStreamBytes,
      embeddedFontStreams: fonts.size,
      embeddedFontStreamBytes,
    });
  } catch (error) {
    results.push({ hash: sample.hash, error: String(error).slice(0, 180) });
  }
  await writeFile(
    path.join(root, "resource-streams.json"),
    JSON.stringify(results, null, 2),
  );
}
console.log(
  JSON.stringify({
    sheets: results.length,
    errors: results.filter((r) => r.error).length,
  }),
);
