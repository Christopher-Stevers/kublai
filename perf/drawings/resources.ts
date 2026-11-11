import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { compress, encodeSpatialPaths } from "./encoding";
const root = path.resolve("perf/drawings/private"),
  corpus = JSON.parse(await readFile(path.join(root, "corpus.json"), "utf8"));
const names = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));
const shard = Number(process.env.DRAWING_SHARD ?? 0),
  shards = Number(process.env.DRAWING_SHARDS ?? 1),
  results: any[] = [];
let prior: any[] = [];
for (const suffix of ["0", "1", "2", "3", "eb8da2f0", "7725eb4b"])
  try {
    prior.push(
      ...JSON.parse(
        await readFile(path.join(root, `resources-${suffix}.json`), "utf8"),
      ).filter((r: any) => !r.error),
    );
  } catch {}
for (const [index, sample] of corpus.samples.entries()) {
  if (index % shards !== shard) continue;
  const previous = prior.find((r: any) => r.hash === sample.hash);
  if (previous && !process.env.DRAWING_ONLY_HASH) {
    results.push(previous);
    continue;
  }
  if (
    process.env.DRAWING_ONLY_HASH &&
    !sample.hash.startsWith(process.env.DRAWING_ONLY_HASH)
  )
    continue;
  let task: any;
  try {
    task = getDocument({
      data: new Uint8Array(await readFile(sample.file)),
      disableFontFace: true,
      fontExtraProperties: true,
      standardFontDataUrl:
        path.resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
      cMapUrl: path.resolve("node_modules/pdfjs-dist/cmaps") + "/",
      cMapPacked: true,
      wasmUrl: path.resolve("node_modules/pdfjs-dist/wasm") + "/",
    });
    const doc = await task.promise,
      p = await doc.getPage(1),
      list = await p.getOperatorList(),
      viewport = p.getViewport({ scale: 1 });
    const glyphs = new Map<string, Uint8Array>(),
      missing = new Set<string>(),
      fontIds = new Set<string>(),
      images = new Map<string, number>();
    let font: any,
      characters = 0;
    for (let i = 0; i < list.fnArray.length; i++) {
      const name = names[list.fnArray[i]],
        args = list.argsArray[i];
      if (name === "setFont") {
        fontIds.add(args[0]);
        try {
          font = p.commonObjs.get(args[0]);
        } catch {
          font = undefined;
        }
      }
      if (name === "showText" || name === "showSpacedText")
        for (const glyph of args[0] ?? []) {
          if (!glyph || typeof glyph !== "object") continue;
          characters++;
          const key = `${font?.loadedName}:${glyph.fontChar}`;
          if (glyphs.has(key) || missing.has(key)) continue;
          try {
            const resource = p.commonObjs.get(
              `${font.loadedName}_path_${glyph.fontChar}`,
            );
            const outline = resource?.path;
            if (!outline) throw Error("missing outline");
            glyphs.set(
              key,
              new Uint8Array(
                outline.buffer,
                outline.byteOffset,
                outline.byteLength,
              ),
            );
          } catch {
            missing.add(key);
          }
        }
      if (name === "paintImageXObject" || name === "paintImageXObjectRepeat") {
        try {
          const image = p.objs.get(args[0]);
          images.set(args[0], image?.data?.byteLength ?? 0);
        } catch {
          images.set(args[0], 0);
        }
      }
    }
    const outlineBytes = Buffer.concat(
        [...glyphs.values()].map((x) => Buffer.from(x)),
      ),
      glyphBrotliBytes = compress(outlineBytes).length;
    const spatial = encodeSpatialPaths(
      list,
      names,
      viewport.width,
      viewport.height,
    );
    results.push({
      hash: sample.hash,
      fontCount: fontIds.size,
      glyphPlacements: characters,
      uniqueGlyphOutlines: glyphs.size,
      unresolvedGlyphOutlines: missing.size,
      glyphOutlineRawBytes: outlineBytes.length,
      glyphOutlineBrotliBytes: glyphBrotliBytes,
      imageResourceCount: images.size,
      decodedImageResourceBytes: [...images.values()].reduce(
        (a, b) => a + b,
        0,
      ),
      spatial,
      geometryPlusGlyphLowerBoundBytes:
        spatial.geometryBrotliBytes + glyphBrotliBytes,
      wholePdfSidecarTransportUpperBoundBytes:
        spatial.geometryBrotliBytes + glyphBrotliBytes + sample.pdfBytes,
      completeCompiledEncoding: false,
    });
  } catch (error) {
    results.push({ hash: sample.hash, error: String(error).slice(0, 180) });
  } finally {
    try {
      await task?.destroy();
    } catch {}
  }
  await writeFile(
    path.join(root, `resources-${process.env.DRAWING_ONLY_HASH ?? shard}.json`),
    JSON.stringify(results, null, 2),
  );
  console.log(
    JSON.stringify({
      processed: results.length,
      total: Math.ceil(corpus.samples.length / shards),
    }),
  );
}
