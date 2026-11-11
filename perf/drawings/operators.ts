import { brotliCompressSync, constants } from "node:zlib";
export type OperatorList = {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
};
export function countPackedPaths(args: unknown) {
  const values = Array.isArray(args) ? args : [];
  const paths = Array.isArray(values[1]) ? values[1] : [];
  let segments = 0,
    subpaths = 0,
    curves = 0;
  for (const packed of paths) {
    if (!packed) continue;
    const numbers = Array.from(packed as ArrayLike<number>);
    for (let i = 0; i < numbers.length; ) {
      const op = numbers[i++];
      if (op === 0) {
        subpaths++;
        i += 2;
      } else if (op === 1) {
        segments++;
        i += 2;
      } else if (op === 2) {
        segments++;
        curves++;
        i += 6;
      } else if (op === 3) {
        segments++;
        curves++;
        i += 4;
      } else if (op === 4) segments++;
      else break;
    }
  }
  return { segments, subpaths, curves };
}
function plain(value: unknown): unknown {
  if (ArrayBuffer.isView(value))
    return Array.from(value as unknown as ArrayLike<number>);
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "data" && ArrayBuffer.isView(v)
          ? { externalResourceByteLength: v.byteLength }
          : plain(v),
      ]),
    );
  return value;
}
export function classify(list: OperatorList, names: Record<number, string>) {
  const counts: Record<string, number> = {},
    unsupported = new Set<string>();
  let paths = 0,
    segments = 0,
    curves = 0,
    subpaths = 0,
    text = 0,
    images = 0,
    clips = 0;
  for (let i = 0; i < list.fnArray.length; i++) {
    const name = names[list.fnArray[i]!] ?? `unknown:${list.fnArray[i]}`;
    counts[name] = (counts[name] ?? 0) + 1;
    const args = list.argsArray[i];
    if (name === "constructPath") {
      paths++;
      const n = countPackedPaths(args);
      segments += n.segments;
      curves += n.curves;
      subpaths += n.subpaths;
    }
    if (/showText|showSpacedText/.test(name)) text++;
    if (/paint.*Image/.test(name)) images++;
    if (/clip/i.test(name)) clips++;
    if (name === "shadingFill") unsupported.add("gradient-or-shading");
    if (name === "setFillColorN" || name === "setStrokeColorN")
      unsupported.add("pattern-color");
    if (name === "setGState")
      for (const entry of (args as unknown[][][])[0] ?? []) {
        if (!Array.isArray(entry)) continue;
        const [key, value] = entry;
        if (key === "SMask" && value !== false && value !== "None")
          unsupported.add("soft-mask");
        if (key === "BM" && value !== "source-over" && value !== "Normal")
          unsupported.add("blend-mode");
      }
  }
  const normalized = {
    version: 0,
    ops: Array.from(list.fnArray, (op, i) => [op, plain(list.argsArray[i])]),
  };
  const payload = Buffer.from(JSON.stringify(normalized));
  const encoded = brotliCompressSync(payload, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  return {
    counts,
    paths,
    segments,
    curves,
    subpaths,
    textOperators: text,
    imageOperators: images,
    clips,
    unsupported: [...unsupported],
    jsonBytes: payload.length,
    operatorOnlyBrotliBytes: encoded.length,
  };
}
// A deliberately small canvas prototype: paths, stroke/fill styles and clipping.
// Text/images/patterns are omitted and always invalidate its fidelity gate.
export function replayPaths(
  ctx: any,
  list: OperatorList,
  names: Record<number, string>,
  transform: number[],
  resources?: { font: (id: string) => any; commonObjs: any },
) {
  ctx.save();
  ctx.fillStyle = "black";
  ctx.strokeStyle = "black";
  ctx.transform(...transform);
  let text = {
    matrix: [1, 0, 0, 1, 0, 0],
    x: 0,
    y: 0,
    lineX: 0,
    lineY: 0,
    font: null as any,
    size: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hscale: 1,
    rise: 0,
    leading: 0,
    mode: 0,
  };
  const textStack: any[] = [];
  const paint = (mode: number) => {
    const n = names[mode] ?? "";
    if (/close/i.test(n)) ctx.closePath();
    if (/fill/i.test(n)) ctx.fill(/eo/i.test(n) ? "evenodd" : "nonzero");
    if (/stroke/i.test(n)) ctx.stroke();
  };
  for (let i = 0; i < list.fnArray.length; i++) {
    const name = names[list.fnArray[i]!]!,
      a = list.argsArray[i] as any[];
    if (name === "save") {
      ctx.save();
      textStack.push({ ...text, matrix: [...text.matrix] });
    } else if (name === "restore") {
      ctx.restore();
      text = textStack.pop() ?? text;
    } else if (name === "transform") ctx.transform(...a);
    else if (resources && name === "beginText") {
      text.x = text.y = text.lineX = text.lineY = 0;
      text.matrix = [1, 0, 0, 1, 0, 0];
    } else if (resources && name === "setFont") {
      text.font = resources.font(a[0]);
      text.size = a[1];
    } else if (resources && name === "setCharSpacing") text.charSpacing = a[0];
    else if (resources && name === "setWordSpacing") text.wordSpacing = a[0];
    else if (resources && name === "setHScale") text.hscale = a[0] / 100;
    else if (resources && name === "setTextRise") text.rise = a[0];
    else if (resources && name === "setLeading") text.leading = -a[0];
    else if (resources && name === "setTextRenderingMode") text.mode = a[0];
    else if (resources && name === "setTextMatrix") {
      text.matrix =
        Array.isArray(a[0]) || ArrayBuffer.isView(a[0])
          ? Array.from(a[0] as ArrayLike<number>)
          : a;
      text.x = text.y = text.lineX = text.lineY = 0;
    } else if (
      resources &&
      (name === "moveText" || name === "setLeadingMoveText")
    ) {
      if (name === "setLeadingMoveText") text.leading = a[1];
      text.x = text.lineX += a[0];
      text.y = text.lineY += a[1];
    } else if (resources && name === "nextLine") {
      text.x = text.lineX;
      text.y = text.lineY += text.leading;
    } else if (
      resources &&
      (name === "showText" || name === "showSpacedText") &&
      text.font &&
      !text.font.isType3Font &&
      !text.font.vertical
    ) {
      ctx.save();
      ctx.transform(...text.matrix);
      ctx.translate(text.x, text.y + text.rise);
      ctx.scale(text.hscale, -1);
      let advance = 0;
      for (const glyph of a[0] ?? []) {
        if (typeof glyph === "number") {
          advance -= (glyph * text.size) / 1000;
          continue;
        }
        if (!glyph) continue;
        try {
          const shape = text.font.getPathGenerator(
            resources.commonObjs,
            glyph.fontChar,
          );
          ctx.save();
          ctx.translate(advance, 0);
          ctx.scale(text.size, -text.size);
          if (text.mode === 0 || text.mode === 2) ctx.fill(shape);
          if (text.mode === 1 || text.mode === 2) ctx.stroke(shape);
          ctx.restore();
        } catch {}
        advance +=
          glyph.width * text.size * (text.font.fontMatrix?.[0] ?? 0.001) +
          text.charSpacing +
          (glyph.isSpace ? text.wordSpacing : 0);
      }
      ctx.restore();
      text.x += advance * text.hscale;
    } else if (name === "setLineWidth") ctx.lineWidth = a[0];
    else if (name === "setLineCap")
      ctx.lineCap = ["butt", "round", "square"][a[0]];
    else if (name === "setLineJoin")
      ctx.lineJoin = ["miter", "round", "bevel"][a[0]];
    else if (name === "setMiterLimit") ctx.miterLimit = a[0];
    else if (name === "setDash") {
      ctx.setLineDash(a[0]);
      ctx.lineDashOffset = a[1];
    } else if (name === "setStrokeRGBColor" || name === "setFillRGBColor") {
      const color = typeof a[0] === "string" ? a[0] : `rgb(${a.join(",")})`;
      ctx[name === "setStrokeRGBColor" ? "strokeStyle" : "fillStyle"] = color;
    } else if (name === "setStrokeGray" || name === "setFillGray") {
      const c = Math.round(a[0] * 255);
      ctx[name === "setStrokeGray" ? "strokeStyle" : "fillStyle"] =
        `rgb(${c},${c},${c})`;
    } else if (name === "constructPath") {
      ctx.beginPath();
      for (const packed of a[1] ?? []) {
        if (!packed) continue;
        const p = Array.from(packed) as number[];
        for (let j = 0; j < p.length; ) {
          const op = p[j++];
          if (op === 0) {
            ctx.moveTo(p[j], p[j + 1]);
            j += 2;
          } else if (op === 1) {
            ctx.lineTo(p[j], p[j + 1]);
            j += 2;
          } else if (op === 2) {
            ctx.bezierCurveTo(...p.slice(j, j + 6));
            j += 6;
          } else if (op === 3) {
            ctx.quadraticCurveTo(...p.slice(j, j + 4));
            j += 4;
          } else if (op === 4) ctx.closePath();
          else break;
        }
      }
      paint(a[0]);
    } else if (name === "clip" || name === "eoClip")
      ctx.clip(name === "eoClip" ? "evenodd" : "nonzero");
  }
  ctx.restore();
}
