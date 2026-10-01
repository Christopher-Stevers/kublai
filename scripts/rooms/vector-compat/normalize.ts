import { OPS, version } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Compatibility only for the pinned worker's fonts_Glyph metadata. Required
 * and optional fields are from its constructor, not inferred drawing classes.
 * https://github.com/mozilla/pdf.js/blob/v6.2.108/src/core/fonts.js
 * TJ is normally converted to showText; showSpacedText is accepted explicitly.
 */
export const NORMALIZATION_PRESET = Object.freeze({
  version: 'pdfjs-optional-glyph-undefined-v1', pdfjsVersion: '6.2.108',
  operators: Object.freeze([OPS.showText, OPS.showSpacedText]) as readonly number[],
  optionalFields: Object.freeze(['accent', 'vmetric', 'operatorListId'] as const),
  maximumOperators: 600_000, maximumTextItems: 1_000_000,
  maximumGlyphs: 500_000, maximumTaggedFields: 1_000_000,
  maximumMetadataValues: 8_000_000, maximumMetadataDepth: 12,
});
export type OptionalGlyphField = typeof NORMALIZATION_PRESET.optionalFields[number];
export type GlyphNormalization = {
  operatorIndex: number; operatorCode: number; glyphIndex: number;
  field: OptionalGlyphField; argumentPath: [0, number, OptionalGlyphField];
  objectKeyIndex: number; originalType: 'undefined';
};
const MARKER = '__pdfjsOptionalGlyphUndefined';
const optional = new Set<string>(NORMALIZATION_PRESET.optionalFields);
const required = ['originalCharCode', 'fontChar', 'unicode', 'width', 'isSpace', 'isInFont'] as const;
const textOperators = new Set<number>(NORMALIZATION_PRESET.operators);
export function glyphUndefinedSentinel(field: OptionalGlyphField) {
  if (!optional.has(field)) throw new Error('Unknown optional glyph field');
  return Object.freeze({ [MARKER]: NORMALIZATION_PRESET.version, field });
}

/**
 * Retains fnArray by identity. Only glyphs with explicitly present undefined
 * metadata are cloned; structural args, numeric arrays and all other values
 * retain their original references. No input is mutated or silently dropped.
 * The caller must still apply the unchanged strict parser to returned args.
 */
export function normalizeTextGlyphArguments(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>) {
  if (version !== NORMALIZATION_PRESET.pdfjsVersion) throw new Error('Pinned PDF.js glyph schema version changed');
  const count = fnArray?.length;
  if (!Number.isSafeInteger(count) || count < 0 || count > NORMALIZATION_PRESET.maximumOperators || argsArray?.length !== count)
    throw new Error('Glyph adapter operator/parallel-array budget');
  const result = Array.from(argsArray), normalizations: GlyphNormalization[] = [];
  let glyphs = 0, textItems = 0, metadataValues = 0;
  const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10_000_000;
  function descriptors(v: object) {
    if (Object.getPrototypeOf(v) !== Object.prototype || Object.getOwnPropertySymbols(v).length)
      throw new Error('Unsupported glyph metadata object type');
    const d = Object.getOwnPropertyDescriptors(v), keys = Object.keys(d);
    if (keys.length > 128 || keys.some(k => k === '__proto__' || !d[k]!.enumerable || !('value' in d[k]!)))
      throw new Error('Unsupported glyph metadata property');
    return d;
  }
  function denseArray(v: unknown[]): void {
    if (Object.getPrototypeOf(v) !== Array.prototype || Object.getOwnPropertySymbols(v).length) throw new Error('Unsupported glyph argument array type');
    const d = Object.getOwnPropertyDescriptors(v), keys = Object.keys(d).filter(k => k !== 'length');
    if (keys.length !== v.length || keys.some(k => !/^\d+$/.test(k) || Number(k) >= v.length || String(Number(k)) !== k || !d[k]!.enumerable || !('value' in d[k]!)))
      throw new Error('Sparse, extended or accessor glyph argument array');
  }
  function serializable(v: unknown, ancestors: Set<object>, depth: number): void {
    if (++metadataValues > NORMALIZATION_PRESET.maximumMetadataValues || depth > NORMALIZATION_PRESET.maximumMetadataDepth)
      throw new Error('Glyph adapter metadata budget');
    if (v === null || typeof v === 'boolean' || number(v)) return;
    if (typeof v === 'string' && v.length <= 65536) return;
    if (!v || typeof v !== 'object') throw new Error('Unsupported glyph metadata value');
    if (ancestors.has(v)) throw new Error('Cyclic glyph metadata');
    ancestors.add(v);
    if (Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView))) {
      if ((v as unknown as ArrayLike<unknown>).length > NORMALIZATION_PRESET.maximumMetadataValues - metadataValues) throw new Error('Glyph adapter metadata budget');
      if (Array.isArray(v)) denseArray(v);
      else if (Object.getOwnPropertyNames(v).length !== (v as unknown as ArrayLike<unknown>).length || Object.getOwnPropertySymbols(v).length) throw new Error('Extended typed glyph metadata array');
      for (const item of Array.from(v as unknown as ArrayLike<unknown>)) serializable(item, ancestors, depth + 1);
    } else {
      const d = descriptors(v);
      if (MARKER in d) throw new Error('Reserved undefined marker already in source glyph');
      for (const property of Object.values(d)) serializable(property.value, ancestors, depth + 1);
    }
    ancestors.delete(v);
  }
  for (let i = 0; i < count; i++) {
    const op = fnArray[i]!;
    if (!textOperators.has(op)) continue;
    const args = argsArray[i];
    if (!Array.isArray(args) || args.length !== 1 || !Array.isArray(args[0])) throw new Error('Unsupported normalized text argument shape');
    const items = args[0] as unknown[];
    textItems += items.length;
    if (textItems > NORMALIZATION_PRESET.maximumTextItems) throw new Error('Glyph adapter text-item budget');
    denseArray(args); denseArray(items);
    let changedItems: unknown[] | null = null;
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      if (number(item) || typeof item === 'string') continue;
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Unknown text glyph object');
      if (++glyphs > NORMALIZATION_PRESET.maximumGlyphs) throw new Error('Glyph adapter glyph budget');
      const d = descriptors(item), keys = Object.keys(d);
      if (required.some(k => !(k in d)) || !number(d.originalCharCode!.value) || !number(d.width!.value) ||
        typeof d.fontChar!.value !== 'string' || typeof d.unicode!.value !== 'string' ||
        typeof d.isSpace!.value !== 'boolean' || typeof d.isInFont!.value !== 'boolean') throw new Error('Unknown pinned worker glyph shape');
      const clone: Record<string, unknown> = {};
      let changed = false;
      for (const key of keys) {
        const value = d[key]!.value;
        if (value === undefined) {
          if (!optional.has(key)) throw new Error('Undefined outside known optional glyph metadata');
          const field = key as OptionalGlyphField;
          clone[key] = glyphUndefinedSentinel(field); changed = true;
          if (normalizations.length >= NORMALIZATION_PRESET.maximumTaggedFields) throw new Error('Glyph adapter tag budget');
          normalizations.push({ operatorIndex: i, operatorCode: op, glyphIndex: j, field,
            argumentPath: [0, j, field], objectKeyIndex: keys.indexOf(key), originalType: 'undefined' });
        } else {
          serializable(value, new Set([item]), 0);
          clone[key] = value;
        }
      }
      if (changed) { changedItems ??= items.slice(); changedItems[j] = clone; }
    }
    if (changedItems) result[i] = [changedItems];
  }
  return { fnArray, argsArray: result, normalizations, preset: NORMALIZATION_PRESET,
    counts: { operators: count, textItems, glyphs, normalizedFields: normalizations.length, metadataValues } };
}
