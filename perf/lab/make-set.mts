// Synthetic drawing set: PAGES distinct dense sheets with links, object streams, not linearized.
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { writeFile } from "node:fs/promises";
const PAGES = Number(process.env.PAGES ?? 40);
const W = 2384, H = 1684;
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const f = (n: number) => n.toFixed(2);
const pages = [];
for (let p = 0; p < PAGES; p++) {
  let seed = 7 + p * 101;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const page = doc.addPage([W, H]);
  pages.push(page);
  page.setFont(font); page.drawText(" ", { x: 0, y: 0, size: 1 });
  const fontName = [...(page.node.Resources()!.lookup(PDFName.of("Font")) as any).dict.keys()][0].asString();
  const ops: string[] = [];
  ops.push("q 0.6 G 0.4 w [6 4] 0 d");
  for (let x = 60; x < W - 60; x += 120) ops.push(`${f(x)} 60 m ${f(x)} ${H - 60} l S`);
  for (let y = 60; y < H - 60; y += 120) ops.push(`60 ${f(y)} m ${W - 60} ${f(y)} l S`);
  ops.push("Q");
  for (let i = 0; i < 1400; i++) {
    const x = 80 + rand() * (W - 600), y = 80 + rand() * (H - 260), w = 20 + rand() * 140, h = 20 + rand() * 110;
    ops.push(`q 0 G ${f(0.3 + rand() * 1.6)} w ${f(x)} ${f(y)} ${f(w)} ${f(h)} re S Q`);
    if (rand() < 0.25) {
      ops.push(`q ${f(x)} ${f(y)} ${f(w)} ${f(h)} re W n 0.35 G 0.15 w`);
      for (let d = -h; d < w; d += 3) ops.push(`${f(x + d)} ${f(y)} m ${f(x + d + h)} ${f(y + h)} l S`);
      ops.push("Q");
    }
  }
  for (let i = 0; i < 700; i++) {
    let x = 80 + rand() * (W - 600), y = 80 + rand() * (H - 260);
    ops.push(`q ${[rand() * 0.8, rand() * 0.5, rand() * 0.9].map(f).join(" ")} RG ${f(0.6 + rand())} w ${f(x)} ${f(y)} m`);
    for (let k = 0; k < 18; k++) {
      if (rand() < 0.5) x += (rand() - 0.5) * 160; else y += (rand() - 0.5) * 160;
      x = Math.max(70, Math.min(W - 520, x)); y = Math.max(70, Math.min(H - 70, y));
      ops.push(`${f(x)} ${f(y)} l`);
    }
    ops.push("S Q");
  }
  ops.push("q 0 G 0.2 w");
  for (let i = 0; i < 26000; i++) {
    const x = 80 + rand() * (W - 600), y = 80 + rand() * (H - 260), a = rand() * Math.PI, l = 1 + rand() * 6;
    ops.push(`${f(x)} ${f(y)} m ${f(x + Math.cos(a) * l)} ${f(y + Math.sin(a) * l)} l`);
    if (i % 50 === 49) ops.push("S");
  }
  ops.push("S Q BT 0 g");
  for (let i = 0; i < 4200; i++) {
    const x = 80 + rand() * (W - 640), y = 80 + rand() * (H - 260), s = 2 + rand() * 5;
    ops.push(`/${fontName} ${f(s)} Tf 1 0 0 1 ${f(x)} ${f(y)} Tm (P-${(rand() * 9999) | 0} DN${[15, 20, 25, 32, 40, 50][(rand() * 6) | 0]} S${p + 1}) Tj`);
  }
  ops.push(`/${fontName} 40 Tf 1 0 0 1 ${W - 480} ${H - 120} Tm (SHEET ${p + 1}) Tj ET`);
  page.node.addContentStream(doc.context.register(doc.context.flateStream(ops.join("\n"))));
}
// A few internal links per sheet, like a hyperlinked set.
pages.forEach((page, p) => {
  const annots = Array.from({ length: 8 }, (_, k) => doc.context.register(doc.context.obj({
    Type: "Annot", Subtype: "Link", Rect: [100 + k * 60, 100, 150 + k * 60, 120], Border: [0, 0, 0],
    Dest: [pages[(p + k + 1) % PAGES]!.ref, PDFName.of("Fit")],
  })));
  page.node.set(PDFName.of("Annots"), doc.context.obj(annots));
});
await writeFile(process.argv[2] ?? "site/sheet/plan.pdf", await doc.save({ useObjectStreams: true }));
