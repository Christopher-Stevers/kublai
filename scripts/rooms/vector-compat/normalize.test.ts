import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseOperatorList } from '../vector-topology/painted-paths';
import { glyphUndefinedSentinel, NORMALIZATION_PRESET, normalizeTextGlyphArguments } from './normalize';

const glyph = () => ({ originalCharCode: 65, fontChar: 'A', unicode: 'A', accent: undefined,
  width: 667, vmetric: undefined, operatorListId: undefined, isSpace: false, isInFont: true });
const input = (fn: number[], args: unknown[]) => ({ sourceSha256: 'a'.repeat(64), pageIndex: 0, width: 200, height: 180,
  viewportTransform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number], fnArray: fn, argsArray: args });

test('only known text glyph optionals are explicitly tagged, with exact paths and original key positions', () => {
  const g = Object.freeze(glyph()), spacing = -120, fn = [OPS.showText, OPS.showSpacedText], args = [Object.freeze([Object.freeze([g, spacing])]), [[g]]];
  const r = normalizeTextGlyphArguments(fn, args); assert.equal(r.fnArray, fn); assert.equal(r.normalizations.length, 6);
  assert.deepEqual(r.normalizations.slice(0, 3).map(n => [n.argumentPath, n.objectKeyIndex]), [[[0, 0, 'accent'], 3], [[0, 0, 'vmetric'], 5], [[0, 0, 'operatorListId'], 6]]);
  const normalized = (r.argsArray[0] as unknown[][])[0]![0] as Record<string, unknown>;
  assert.deepEqual(normalized.accent, glyphUndefinedSentinel('accent')); assert.equal((r.argsArray[0] as unknown[][])[0]![1], spacing);
  assert.ok(Object.hasOwn(g, 'accent')); assert.equal(g.accent, undefined); assert.equal(normalized.width, g.width);
  // Reconstruct exactly using the published ledger, including own-property order.
  const restored = { ...normalized }; for (const n of r.normalizations.filter(n => n.operatorIndex === 0)) restored[n.field] = undefined;
  assert.deepEqual(restored, g); assert.deepEqual(Object.keys(restored), Object.keys(g));
  assert.doesNotThrow(() => parseOperatorList(input(fn, r.argsArray)));
});
test('absent, null and numeric metadata are distinct and retained by reference', () => {
  const g = { ...glyph(), accent: null, vmetric: [700, 350, 800], operatorListId: 7 }; const fn = [OPS.showText], args = [[ [g] ]];
  const r = normalizeTextGlyphArguments(fn, args); assert.equal(r.normalizations.length, 0); assert.equal(r.argsArray[0], args[0]);
  const absent: Record<string, unknown> = { ...g }; delete absent.accent; const a = normalizeTextGlyphArguments(fn, [[[absent]]]);
  assert.equal(a.normalizations.length, 0); assert.ok(!Object.hasOwn(absent, 'accent'));
});
test('structural commands/numeric arrays/unknown nontext objects are untouched and still fail strict parsing when unsupported', () => {
  for (const arg of [[undefined], [NaN], [new Date()], [glyph()]]) {
    const fn = [OPS.transform], args = [arg], r = normalizeTextGlyphArguments(fn, args); assert.equal(r.argsArray[0], arg); assert.equal(r.normalizations.length, 0);
    assert.throws(() => parseOperatorList(input(fn, r.argsArray)));
  }
  const numeric = new Float32Array([1, 0, 0, 1, 20, 10]); const r = normalizeTextGlyphArguments([OPS.transform], [numeric]); assert.equal(r.argsArray[0], numeric);
});
test('unknown glyph object/undefined metadata, accessors and cycles fail instead of being dropped', () => {
  for (const g of [new Date(), {}, { ...glyph(), extra: undefined }, { ...glyph(), extra: new Map() }, { ...glyph(), extra: Symbol('x') },
    { ...glyph(), extra: glyphUndefinedSentinel('accent') }]) assert.throws(() => normalizeTextGlyphArguments([OPS.showText], [[[g]]]));
  let called = false; const accessor = glyph(); Object.defineProperty(accessor, 'width', { enumerable: true, get() { called = true; return 667; } });
  assert.throws(() => normalizeTextGlyphArguments([OPS.showText], [[[accessor]]])); assert.equal(called, false);
  const cyclic: Record<string, unknown> = { ...glyph() }; cyclic.extra = cyclic;
  assert.throws(() => normalizeTextGlyphArguments([OPS.showText], [[[cyclic]]]), /Cyclic/);
});
test('undefined nested in numeric metadata or outside glyph slot is never normalized', () => {
  for (const args of [[[undefined]], [[{ ...glyph(), vmetric: [undefined, 1, 2] }]], [[glyph()], undefined]])
    assert.throws(() => normalizeTextGlyphArguments([OPS.showText], [args]));
  assert.throws(() => normalizeTextGlyphArguments([OPS.showText], []), /parallel-array/);
});
test('sparse, hidden, symbol and accessor array metadata cannot be silently dropped', () => {
  for (const modifier of [(a: unknown[]) => Object.defineProperty(a, 'hidden', { value: 1 }),
    (a: unknown[]) => Object.defineProperty(a, Symbol('extra'), { value: 1 }),
    (a: unknown[]) => Object.defineProperty(a, '0', { enumerable: true, get() { throw new Error('getter must not execute'); } })]) {
    const a: unknown[] = [glyph()]; modifier(a); assert.throws(() => normalizeTextGlyphArguments([OPS.showText], [[a]]), /array/);
  }
  assert.ok(Object.isFrozen(NORMALIZATION_PRESET.optionalFields)); assert.ok(Object.isFrozen(NORMALIZATION_PRESET.operators));
});
test('undefined source metadata survives JSON via a distinct versioned marker, not null/missing', () => {
  const r = normalizeTextGlyphArguments([OPS.showText], [[[glyph()]]]); const roundtrip = JSON.parse(JSON.stringify(r));
  const g = roundtrip.argsArray[0][0][0]; assert.deepEqual(g.vmetric, glyphUndefinedSentinel('vmetric')); assert.notEqual(g.vmetric, null);
  assert.equal(roundtrip.normalizations.length, 3);
});

function textPdf() {
  const contents = '0 G 0.5 w 10 100 m 60 100 l S\nBT /F1 12 Tf 1 0 0 1 40 130 Tm (Room A) Tj [(Hall) -80 (Way)] TJ ET\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(contents)} >>\nstream\n${contents}endstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let text = '%PDF-1.7\n'; const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(text); text += `xref\n0 6\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(text));
}
test('actual pinned worker on a fabricated Helvetica Tj/TJ PDF exposes undefineds and normalized strict parser stays conservative', async () => {
  const bytes = textPdf(), sha = createHash('sha256').update(bytes).digest('hex');
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false, disableFontFace: true, stopAtErrors: true });
  try {
    const doc = await task.promise, page = await doc.getPage(1), viewport = page.getViewport({ scale: 1 }), ops = await page.getOperatorList();
    assert.ok(ops.fnArray.includes(OPS.showText));
    const originals = ops.argsArray.map(a => a); const r = normalizeTextGlyphArguments(ops.fnArray, ops.argsArray);
    assert.ok(r.normalizations.length > 0); assert.ok(r.normalizations.some(n => n.field === 'vmetric')); assert.ok(r.normalizations.some(n => n.field === 'operatorListId'));
    for (const n of r.normalizations) { const g = (ops.argsArray[n.operatorIndex] as unknown[][])[0]![n.glyphIndex] as Record<string, unknown>; assert.ok(Object.hasOwn(g, n.field)); assert.equal(g[n.field], undefined); }
    assert.deepEqual(ops.argsArray, originals);
    const base = { sourceSha256: sha, pageIndex: 0, width: viewport.width, height: viewport.height,
      viewportTransform: Array.from(viewport.transform) as [number, number, number, number, number, number], fnArray: ops.fnArray };
    assert.throws(() => parseOperatorList({ ...base, argsArray: ops.argsArray }), /unsupported operator argument/);
    const parsed = parseOperatorList({ ...base, argsArray: r.argsArray });
    assert.equal(parsed.lines.length, 1); assert.equal(parsed.diagnostics.eligibleLines, 0);
    assert.ok(parsed.lines[0]!.reasons.includes('later-text-visibility-unresolved'));
    assert.equal(parsed.sourceSha256, sha);
  } finally { await task.destroy(); }
});
