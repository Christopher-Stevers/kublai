import { createCanvas, type Canvas } from "@napi-rs/canvas";
import type { OperatorList } from "./operators";

// pdf.js ImageKind: 1=packed grayscale, 2=RGB24, 3=RGBA32.
// This bounded slice deliberately supports only byte-aligned RGB/RGBA.
export function collectImageResources(
  list: OperatorList,
  names: Record<number, string>,
  resolve: (id: string) => any,
) {
  const resources = new Map<
    string,
    {
      canvas: Canvas;
      bytes: number;
      interpolate: boolean;
    }
  >();
  const failures = new Set<string>();
  const inlineKeys = new Map<object, string>();
  let decodedBytes = 0,
    placements = 0;
  const keyAt = (index: number, image: any) => {
    if (names[list.fnArray[index]!] === "paintImageXObject")
      return `xobject:${String((list.argsArray[index] as any[])[0])}`;
    if (!image || typeof image !== "object") return `invalid-inline:${index}`;
    let key = inlineKeys.get(image);
    if (!key) {
      key = `inline:${index}`;
      inlineKeys.set(image, key);
    }
    return key;
  };
  for (let i = 0; i < list.fnArray.length; i++) {
    const name = names[list.fnArray[i]!] ?? "",
      args = list.argsArray[i] as any[];
    if (
      /paint.*Image/.test(name) &&
      name !== "paintImageXObject" &&
      name !== "paintInlineImageXObject"
    )
      failures.add(`unsupported:${name}`);
    if (name === "beginGroup" || name === "beginAnnotation")
      failures.add(`unsupported:${name}`);
    if (name === "setGState")
      for (const [key, value] of args[0] ?? []) {
        if (
          (key === "BM" && value !== "source-over" && value !== "Normal") ||
          (key === "SMask" && value !== false) ||
          ((key === "ca" || key === "CA") && value !== 1)
        )
          failures.add(`unsupported:graphics-${key}`);
      }
  }
  const blocked = failures.size > 0;
  for (let i = 0; i < list.fnArray.length; i++) {
    const name = names[list.fnArray[i]!] ?? "",
      args = list.argsArray[i] as any[];
    if (name !== "paintImageXObject" && name !== "paintInlineImageXObject")
      continue;
    placements++;
    let image: any;
    try {
      image = name === "paintImageXObject" ? resolve(args[0]) : args[0];
    } catch {
      failures.add("missing-resource");
      continue;
    }
    const key = keyAt(i, image);
    if (resources.has(key)) continue;
    const { width, height, kind, data } = image ?? {};
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width * height > 4_194_304
    ) {
      failures.add("invalid-image-bounds");
      continue;
    }
    if ((kind !== 2 && kind !== 3) || image.bitmap) {
      failures.add("unsupported-pixel-kind");
      continue;
    }
    const channels = kind === 2 ? 3 : 4,
      expected = width * height * channels;
    if (
      !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) ||
      data.byteLength !== expected
    ) {
      failures.add("invalid-pixel-data");
      continue;
    }
    if (decodedBytes + width * height * 4 > 67_108_864) {
      failures.add("page-image-budget");
      continue;
    }
    if (blocked) continue;
    const canvas = createCanvas(width, height),
      ctx = canvas.getContext("2d"),
      pixels = ctx.createImageData(width, height);
    for (let j = 0, k = 0; j < data.length; j += channels, k += 4) {
      pixels.data[k] = data[j]!;
      pixels.data[k + 1] = data[j + 1]!;
      pixels.data[k + 2] = data[j + 2]!;
      pixels.data[k + 3] = channels === 4 ? data[j + 3]! : 255;
    }
    ctx.putImageData(pixels, 0, 0);
    decodedBytes += pixels.data.byteLength;
    resources.set(key, {
      canvas,
      bytes: pixels.data.byteLength,
      interpolate: image.interpolate === true,
    });
  }
  return {
    paint(ctx: any, index: number, image: any) {
      const resource = resources.get(keyAt(index, image));
      if (!resource) return;
      // Matches pdf.js paintInlineImageXObject: PDF unit square, top-down pixels.
      ctx.save();
      ctx.scale(1 / resource.canvas.width, -1 / resource.canvas.height);
      ctx.imageSmoothingEnabled = resource.interpolate;
      ctx.drawImage(resource.canvas, 0, -resource.canvas.height);
      ctx.restore();
    },
    stats: {
      placements,
      uniqueResources: resources.size,
      ownedRgbaBytes: decodedBytes,
      failures: [...failures].sort(),
      imageReplayEligible: failures.size === 0,
      completeEncoding: false,
    },
  };
}
