import type { OperatorList } from "./operators";

/** Host-spike coverage audit, not a compiler/production eligibility certificate.
 * Never include PDF arguments, glyphs, resource IDs or coordinates in reports. */
export function auditReplaySupport(
  list: OperatorList,
  names: Record<number, string>,
  capabilities: {
    glyphs: boolean;
    images: boolean;
    forms: boolean;
    strokeStyles: boolean;
  },
) {
  const operationCounts: Record<string, number> = {};
  const graphicsStateKeys: Record<string, number> = {};
  const failureCounts: Record<string, number> = {};
  const fail = (reason: string) => {
    failureCounts[reason] = (failureCounts[reason] ?? 0) + 1;
  };
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const vector = (value: unknown, length: number) =>
    (Array.isArray(value) || value instanceof Float32Array || value instanceof Float64Array) &&
    value.length === length && Array.from(value).every(finite);
  const paintModes = new Set([
    "stroke", "closeStroke", "fill", "eoFill", "fillStroke",
    "eoFillStroke", "closeFillStroke", "closeEOFillStroke", "endPath",
  ]);
  const textOperators = new Set([
    "beginText", "endText", "setFont", "setCharSpacing", "setWordSpacing",
    "setHScale", "setTextRise", "setLeading", "setTextRenderingMode",
    "setTextMatrix", "moveText", "setLeadingMoveText", "nextLine",
    "showText", "showSpacedText",
  ]);
  const styleOperators = new Set([
    "setLineWidth", "setLineCap", "setLineJoin", "setMiterLimit", "setDash",
  ]);
  // pdf.js implements rendering intent / flatness as no-ops. Dependency payloads
  // are resource scheduling; actual font/image resolution is checked separately.
  const inertOperators = new Set(["dependency", "setRenderingIntent", "setFlatness"]);
  // Installed pdf.worker.mjs also emits addOp(OPS.save/restore/nextLine)
  // without an argument array. Normalize only genuinely argument-free commands.
  const noArgumentOperators = new Set([
    "save", "restore", "clip", "eoClip", "beginText", "endText",
    "nextLine", "paintFormXObjectEnd",
  ]);
  const supportedOperators = new Set([
    ...textOperators, ...styleOperators, ...inertOperators,
    "save", "restore", "transform", "constructPath", "clip", "eoClip",
    "setGState", "setStrokeRGBColor", "setFillRGBColor", "setStrokeGray",
    "setFillGray", "paintImageXObject", "paintInlineImageXObject",
    "paintFormXObjectBegin", "paintFormXObjectEnd",
  ]);
  const styleKeys = new Set(["LW", "LC", "LJ", "ML", "D"]);
  const knownStateKeys = new Set([
    ...styleKeys, "RI", "FL", "Font", "CA", "ca", "BM", "SMask", "TR",
  ]);
  const checkStyle = (key: string, value: unknown) => {
    if (!capabilities.strokeStyles) fail("stroke-styles-disabled");
    if (key === "LW" && (!finite(value) || value < 0)) fail("invalid-line-width");
    if ((key === "LC" || key === "LJ") &&
        (!finite(value) || !Number.isInteger(value) || value < 0 || value > 2))
      fail("invalid-line-cap-or-join");
    if (key === "ML" && (!finite(value) || value <= 0)) fail("invalid-miter-limit");
    if (key === "D") {
      if (!Array.isArray(value) || value.length !== 2 ||
          !Array.isArray(value[0]) || !finite(value[1]) ||
          !value[0].every((part: unknown) => finite(part) && part >= 0) ||
          (value[0].length > 0 && !value[0].some((part: number) => part > 0)))
        fail("invalid-dash");
    }
  };
  const operations = list.fnArray.length;
  if (!Number.isSafeInteger(operations) || operations < 0 ||
      operations !== list.argsArray.length) {
    fail("invalid-operator-list");
  } else for (let i = 0; i < operations; i++) {
    const name = names[list.fnArray[i]!];
    // Unknown operator names/keys are never copied from input into reports.
    const safeName = name && supportedOperators.has(name) ? name : "unsupported";
    operationCounts[safeName] = (operationCounts[safeName] ?? 0) + 1;
    if (!name || !supportedOperators.has(name)) {
      fail("unsupported-operator");
      continue;
    }
    const rawArgs = list.argsArray[i];
    const args = rawArgs == null && noArgumentOperators.has(name) ? [] : rawArgs;
    if (!Array.isArray(args)) {
      fail("invalid-operator-arguments");
      continue;
    }
    if (styleOperators.has(name)) {
      const key = ({ setLineWidth: "LW", setLineCap: "LC", setLineJoin: "LJ",
        setMiterLimit: "ML", setDash: "D" } as Record<string, string>)[name]!;
      checkStyle(key, name === "setDash" ? args : args[0]);
    } else if (name === "setGState") {
      if (!Array.isArray(args[0])) {
        fail("invalid-graphics-state");
        continue;
      }
      for (const entry of args[0]) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
          fail("invalid-graphics-state");
          continue;
        }
        const [key, value] = entry;
        const safeKey = knownStateKeys.has(key) ? key : "unsupported";
        graphicsStateKeys[safeKey] = (graphicsStateKeys[safeKey] ?? 0) + 1;
        if (styleKeys.has(key)) checkStyle(key, value);
        else if (key === "RI" || key === "FL") { /* Same inert reference setters. */ }
        else if ((key === "CA" || key === "ca") && value === 1) { /* Opaque default. */ }
        else if (key === "BM" && (value === "Normal" || value === "source-over")) { /* Normal default. */ }
        else if (key === "SMask" && value === false) { /* No mask. */ }
        else fail(knownStateKeys.has(key) ? `unsupported-graphics-${key}` : "unsupported-graphics-key");
      }
    } else if (name === "transform" && !vector(args, 6)) {
      fail("invalid-transform");
    } else if (name === "constructPath") {
      if (!paintModes.has(names[args[0]] ?? "")) fail("unsupported-path-paint");
      if (!Array.isArray(args[1])) {
        fail("invalid-packed-paths");
        continue;
      }
      for (const packed of args[1]) {
        // pdf.js may include empty slots; no paint occurs for them.
        if (packed == null) continue;
        if (!(Array.isArray(packed) || packed instanceof Float32Array || packed instanceof Float64Array)) {
          fail("invalid-packed-path");
          continue;
        }
        for (let j = 0; j < packed.length;) {
          const command = packed[j++];
          const length = command === 0 || command === 1 ? 2 :
            command === 2 ? 6 : command === 3 ? 4 : command === 4 ? 0 : -1;
          if (length < 0) { fail("unsupported-packed-command"); break; }
          if (j + length > packed.length) { fail("truncated-packed-command"); break; }
          for (let k = 0; k < length; k++)
            if (!finite(packed[j + k])) fail("nonfinite-path-coordinate");
          j += length;
        }
      }
    } else if (name === "paintImageXObject" || name === "paintInlineImageXObject") {
      if (!capabilities.images) fail("image-resources-disabled");
    } else if (name === "paintFormXObjectBegin" || name === "paintFormXObjectEnd") {
      if (!capabilities.forms) fail("form-replay-disabled");
      if (name === "paintFormXObjectBegin") {
        if (args[0] != null && !vector(args[0], 6)) fail("invalid-form-matrix");
        if (args[1] != null && !vector(args[1], 4)) fail("invalid-form-bbox");
      }
    } else if (textOperators.has(name)) {
      if (!capabilities.glyphs) fail("glyph-resources-disabled");
      if (name === "setTextRenderingMode" && args[0] !== 0)
        fail("unsupported-text-rendering-mode");
      if (name === "setFont" && (!finite(args[1]) || args[1] < 0))
        fail("unsupported-font-size");
      if (name === "setTextMatrix" && !vector(Array.isArray(args[0]) || ArrayBuffer.isView(args[0]) ? args[0] : args, 6))
        fail("invalid-text-matrix");
      if (["moveText", "setLeadingMoveText"].includes(name) && !vector(args, 2))
        fail("invalid-text-position");
      if (["setCharSpacing", "setWordSpacing", "setHScale", "setTextRise", "setLeading"].includes(name) && !finite(args[0]))
        fail("invalid-text-state");
    } else if (name === "setStrokeGray" || name === "setFillGray") {
      if (!finite(args[0]) || args[0] < 0 || args[0] > 1) fail("unsupported-color-value");
    } else if (name === "setStrokeRGBColor" || name === "setFillRGBColor") {
      if (!(typeof args[0] === "string" && /^#[0-9a-f]{6}$/i.test(args[0])) &&
          !(args.length === 3 && args.every((part: unknown) => finite(part) && part >= 0 && part <= 255)))
        fail("unsupported-color-value");
    }
  }
  const failures = Object.keys(failureCounts).sort();
  return {
    version: 1 as const,
    operations: Number.isSafeInteger(operations) && operations >= 0 ? operations : 0,
    operationCounts,
    graphicsStateKeys,
    failures,
    failureCounts,
    subsetSupported: failures.length === 0,
    completeEncoding: false as const,
    productionEligible: false as const,
  };
}
