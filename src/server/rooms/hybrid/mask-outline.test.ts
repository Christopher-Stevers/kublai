import { describe, expect, it } from "vitest";

import { labelOutlines, simplifyPath, traceOuterBoundary } from "./mask-outline";

function grid(rows: string[]) {
  const h = rows.length;
  const w = rows[0]!.length;
  const labels = new Int32Array(w * h);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      labels[y * w + x] = ch === "." ? 0 : Number(ch);
    }),
  );
  return { labels, w, h };
}

describe("mask outlines", () => {
  it("traces a rectangle as its four pixel corners", () => {
    const inside = new Uint8Array([1, 1, 1, 1, 1, 1]);
    expect(traceOuterBoundary(inside, 3, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 0, y: 2 },
    ]);
  });

  it("traces an L shape with six corners", () => {
    const { labels, w, h } = grid(["11.", "11.", "111"]);
    const inside = Uint8Array.from(labels, (v) => (v ? 1 : 0));
    const corners = traceOuterBoundary(inside, w, h);
    expect(corners).toHaveLength(6);
    expect(corners).toContainEqual({ x: 3, y: 3 });
    expect(corners).toContainEqual({ x: 2, y: 2 });
  });

  it("keeps each label's largest area and drops tiny labels", () => {
    const { labels, w } = grid([
      "1111..22",
      "1111..22",
      "1111....",
      "......3.",
      "1.......",
    ]);
    const outlines = labelOutlines(labels, w, { epsilon: 0.5, minAreaPx: 2 });
    expect(outlines.map((o) => o.label)).toEqual([1, 2]);
    expect(outlines[0]!.areaPx).toBe(12);
    expect(outlines[0]!.points).toHaveLength(4);
  });

  it("simplifies collinear staircase noise", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 5, y: 0.3 },
      { x: 10, y: 0 },
    ];
    expect(simplifyPath(path, 1)).toEqual([path[0], path[2]]);
  });
});

it('retains a central void in a ring-shaped corridor',()=>{
 const w=15,h=15,labels=new Int32Array(w*h);
 for(let y=2;y<13;y++)for(let x=2;x<13;x++)if(x<5||x>=10||y<5||y>=10)labels[y*w+x]=1;
 const [outline]=labelOutlines(labels,w,{epsilon:0,minAreaPx:1,includeHoles:true});
 expect(outline?.holes).toHaveLength(1);
 expect(outline?.areaPx).toBe(96);
});
