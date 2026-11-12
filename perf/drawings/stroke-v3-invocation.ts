import path from "node:path";
import { mkdir, realpath, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export const STROKE_V3_HASH = "268d1043b94a91e45a813bd7c62f1ad966a0515045984de3536123c16fb00215";
export const STROKE_V3_PROTOCOL = "combined-stroke-v3-single-existing-sample";
type Env = Record<string, string | undefined>;

export function validateDrawingInvocation(env: Env, privateRoot: string) {
  const integer = (key: string, fallback: string) => {
    const value = env[key] ?? fallback;
    if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new Error(`Invalid ${key}`);
    return Number(value);
  };
  const shard = integer("DRAWING_SHARD", "0");
  const shards = integer("DRAWING_SHARDS", "1");
  if (shards < 1 || shard >= shards) throw new Error("Invalid drawing shard range");
  if (env.DRAWING_STROKE_V3 !== undefined && env.DRAWING_STROKE_V3 !== "1")
    throw new Error("Ambiguous stroke-v3 flag");
  const strokeV3 = env.DRAWING_STROKE_V3 === "1";
  if (!strokeV3) {
    if (env.DRAWING_STROKE_V3_OUTPUT !== undefined)
      throw new Error("Stroke-v3 output requires explicit mode");
    return { strokeV3, shard, shards, output: null };
  }
  for (const key of ["DRAWING_COMBINED_PROTOTYPE", "DRAWING_IMAGE_PROTOTYPE", "DRAWING_GLYPH_PROTOTYPE"])
    if (env[key] !== undefined) throw new Error("Mixed stroke-v3 prototype flags");
  if (env.DRAWING_ONLY_HASH !== STROKE_V3_HASH || shard !== 0 || shards !== 1)
    throw new Error("Stroke-v3 requires exact full existing hash and one shard");
  const output = env.DRAWING_STROKE_V3_OUTPUT;
  if (!output || !path.isAbsolute(output) || path.dirname(output) !== privateRoot ||
      !/^stroke-v3-[A-Za-z0-9_-]+$/.test(path.basename(output)))
    throw new Error("Explicit fresh direct-child stroke-v3 output required");
  return { strokeV3, shard, shards, output };
}

export function selectStrokeV3Sample<T extends { hash: string }>(samples: T[]) {
  const selected = samples.filter(sample => sample.hash === STROKE_V3_HASH);
  if (selected.length !== 1) throw new Error("Exactly one existing full-hash sample required");
  return selected[0]!;
}

export function verifyStrokeV3Bytes(bytes: Uint8Array) {
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== STROKE_V3_HASH) throw new Error("Existing sample bytes differ from full hash");
  return hash;
}

export async function reserveStrokeV3Output(output: string, privateRoot: string) {
  // The parent must already be the actual private root. No recursive creation,
  // symlink traversal or cleanup/replacement of a previous failed attempt.
  if (await realpath(path.dirname(output)) !== await realpath(privateRoot))
    throw new Error("Stroke-v3 output parent escape");
  await mkdir(output, { recursive: false, mode: 0o700 });
  await mkdir(path.join(output, "previews"), { recursive: false, mode: 0o700 });
}

export async function fingerprintStrokeV3Inputs(names: string[]) {
  const entries: Record<string, string> = {};
  for (const name of names) entries[name] = createHash("sha256").update(await readFile(name)).digest("hex");
  return entries;
}

export const PDFJS_V2_REFERENCE_SHA256 = "842284e0d1d439e60701e3355c2128cd3016ebebf14220e27f512467682aad66";
export function verifyStrokeV3ReferenceInputs(inputs: Record<string,string>, corpusBytes: Uint8Array, privateRoot: string) {
  const corpusHash = createHash("sha256").update(corpusBytes).digest("hex");
  if (inputs[path.join(privateRoot,"corpus.json")] !== corpusHash)
    throw new Error("Corpus manifest changed after the selected bytes were read");
  if (inputs["node_modules/pdfjs-dist/legacy/build/pdf.mjs"] !== PDFJS_V2_REFERENCE_SHA256)
    throw new Error("Installed pdf.js reference differs from pinned v2 source");
  return { corpusManifestSha256: corpusHash, pdfjsReferenceSha256: PDFJS_V2_REFERENCE_SHA256 };
}
