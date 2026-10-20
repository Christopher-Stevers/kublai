import { describe, expect, it, vi } from "vitest";
import {
  PIPE_OPS,
  loadPipeLinework,
  pipeLabelsFromTextItems,
  pipeLineworkFromOperators,
  pipeSystemTokens,
} from "./pdf-pipe-lines";
import type { PipeExtractionOptions } from "./pdf-pipe-lines";

const pdf = vi.hoisted(() => ({ load: vi.fn(), library: vi.fn() }));
vi.mock("./pdf-client", () => ({
  loadPdfDocument: pdf.load,
  loadPdfJs: pdf.library,
}));

type Point = { x: number; y: number };
const toSheet = (x: number, y: number) => ({ x: x / 100, y: y / 100 });
function run(
  ops: Array<[number, unknown[]]>,
  options: PipeExtractionOptions = {},
  project = toSheet,
) {
  return pipeLineworkFromOperators(
    ops.map(([fn]) => fn),
    ops.map(([, args]) => args),
    project,
    options,
  );
}
const path = (
  values: number[],
  paint: number = PIPE_OPS.stroke,
): [number, unknown[]] => [
  PIPE_OPS.constructPath,
  [paint, [Float32Array.from(values)], Float32Array.from([0, 0, 100, 100])],
];
const line = (y: number) => path([0, 10, y, 1, 90, y]);
const text = (str: string, x = 10, y = 20, width = 10, height = 5) => ({
  str,
  transform: [5, 0, 0, 5, x, y],
  width,
  height,
});

describe("pipe strokes from PDF operators", () => {
  it("keeps stroked paths and their normalized style, excluding filled outlines and white erasures", () => {
    const result = run([
      [PIPE_OPS.setLineWidth, [2]],
      [PIPE_OPS.setDash, [[4, 2], 1]],
      [PIPE_OPS.setStrokeRGBColor, ["#AABBCC"]],
      line(30),
      path([0, 10, 40, 1, 90, 40], PIPE_OPS.fill),
      [PIPE_OPS.setStrokeRGBColor, ["#ffffff"]],
      line(50),
    ]);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      x1: 0.1,
      y1: 0.3,
      x2: 0.9,
      y2: 0.3,
      stroke: "#aabbcc",
      width: 0.02,
      dash: [0.04, 0.02],
    });
    expect(result.truncated).toBe(false);
  });

  it("restores color, width, dash, transform and opacity across save/restore and forms", () => {
    const result = run([
      [PIPE_OPS.save, []],
      [PIPE_OPS.transform, [2, 0, 0, 2, 10, 5]],
      [
        PIPE_OPS.setGState,
        [
          [
            ["LW", 3],
            ["D", [[2, 1], 0]],
          ],
        ],
      ],
      [PIPE_OPS.setStrokeRGBColor, ["#ff0000"]],
      path([0, 0, 0, 1, 10, 0]),
      [PIPE_OPS.restore, []],
      [
        PIPE_OPS.paintFormXObjectBegin,
        [Float32Array.from([1, 0, 0, 1, 20, 30]), [0, 0, 20, 20]],
      ],
      path([0, -10, 10, 1, 30, 10]),
      [PIPE_OPS.paintFormXObjectEnd, []],
      [PIPE_OPS.save, []],
      [PIPE_OPS.setGState, [[["CA", 0]]]],
      line(50),
      [PIPE_OPS.restore, []],
      line(60),
    ]);
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toMatchObject({
      x1: 0.1,
      y1: 0.05,
      x2: 0.3,
      y2: 0.05,
      stroke: "#ff0000",
    });
    expect(result.segments[0]!.width).toBeCloseTo(0.06);
    expect(result.segments[0]!.dash[0]).toBeCloseTo(0.04);
    expect(result.segments[1]).toMatchObject({
      x1: 0.2,
      y1: 0.4,
      x2: 0.4,
      y2: 0.4,
      stroke: "#000000",
      dash: [],
    });
    expect(result.segments[2]!.width).toBeCloseTo(0.01);
  });

  it("uses crop, viewport rotation, and UserUnit consistently for coordinates and widths", () => {
    // A cropped 200×100 PDF user-space view rotated 270° with UserUnit2:
    // viewport200×400. Fractions are invariant to UserUnit, aspect is2.
    const rotate = (x: number, y: number) => ({
      x: (100 - (y - 20)) / 100,
      y: (x - 10) / 200,
    });
    const result = run([path([0, 10, 20, 1, 210, 20])], { aspect: 2 }, rotate);
    expect(result.segments[0]).toMatchObject({ x1: 1, y1: 0, x2: 1, y2: 1 });
    expect(result.segments[0]!.width).toBeCloseTo(0.01);
    expect(result.aspect).toBe(2);
  });

  it("clips crossing lines to the visible sheet and a rectangular PDF clipping path", () => {
    const result = run([
      path([0, -10, 10, 1, 120, 10]),
      [PIPE_OPS.clip, []],
      path([0, 20, 20, 1, 60, 20, 1, 60, 60, 1, 20, 60, 4], PIPE_OPS.endPath),
      line(40),
    ]);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({
      x1: 0,
      y1: 0.1,
      x2: 1,
      y2: 0.1,
    });
    expect(result.segments[1]).toMatchObject({
      x1: 0.2,
      y1: 0.4,
      x2: 0.6,
      y2: 0.4,
    });
  });

  it("preserves straight closed loops but excludes closed curved symbols", () => {
    const result = run([
      path([0, 10, 10, 1, 30, 10, 1, 30, 30, 1, 10, 30, 4]),
      path([0, 40, 40, 2, 50, 40, 50, 50, 40, 50, 4]),
    ]);
    expect(result.segments).toHaveLength(4);
    expect(result.segments.every((s) => s.closed)).toBe(true);
    expect(new Set(result.segments.map((s) => s.pathId)).size).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.warnings).toBeUndefined();
  });

  it("measures a curved elbow with adaptive segments against a cubic reference", () => {
    const k = 0.5522847498307936,
      radius = 10;
    const result = run([
      [PIPE_OPS.moveTo, [10, 10]],
      [PIPE_OPS.lineTo, [20, 10]],
      [PIPE_OPS.curveTo, [20 + k * radius, 10, 30, 20 - k * radius, 30, 20]],
      [PIPE_OPS.lineTo, [30, 30]],
      [PIPE_OPS.stroke, []],
    ]);
    const cubic = (t: number): Point => ({
      x:
        ((1 - t) ** 3 * 20 +
          3 * (1 - t) ** 2 * t * (20 + k * radius) +
          3 * (1 - t) * t ** 2 * 30 +
          t ** 3 * 30) /
        100,
      y:
        ((1 - t) ** 3 * 10 +
          3 * (1 - t) ** 2 * t * 10 +
          3 * (1 - t) * t ** 2 * (20 - k * radius) +
          t ** 3 * 20) /
        100,
    });
    let reference = 0.2,
      previous = cubic(0);
    for (let i = 1; i <= 10_000; i++) {
      const next = cubic(i / 10_000);
      reference += Math.hypot(next.x - previous.x, next.y - previous.y);
      previous = next;
    }
    const length = result.segments.reduce(
      (total, s) => total + Math.hypot(s.x2 - s.x1, s.y2 - s.y1),
      0,
    );
    expect(length).toBeCloseTo(reference, 6);
    expect(length).toBeGreaterThan(0.2 + Math.sqrt(0.02));
    expect(result.segments.length).toBeGreaterThan(10);
    expect(result.segments[0]).toMatchObject({
      x1: 0.1,
      y1: 0.1,
      x2: 0.2,
      y2: 0.1,
    });
    expect(result.segments.at(-1)).toMatchObject({
      x1: 0.3,
      y1: 0.2,
      x2: 0.3,
      y2: 0.3,
    });
    expect(result.truncated).toBe(false);
  });

  it("supports serialized quadratic curves and raw abbreviated cubic operators", () => {
    const quadratic = run([path([0, 10, 10, 3, 20, 20, 30, 10])]);
    const variants = run([
      [PIPE_OPS.moveTo, [10, 10]],
      [PIPE_OPS.curveTo2, [20, 10, 20, 20]],
      [PIPE_OPS.curveTo3, [20, 30, 30, 30]],
      [PIPE_OPS.stroke, []],
    ]);
    expect(quadratic.segments.length).toBeGreaterThan(1);
    expect(variants.segments.length).toBeGreaterThan(1);
    expect(variants.segments.at(-1)).toMatchObject({ x2: 0.3, y2: 0.3 });
    expect(variants.truncated).toBe(false);
  });

  it("bounds dense curves and segment counts and does not report their chord as a total", () => {
    const limited = run([path([0, 0, 0, 2, 100, 0, 0, 100, 100, 100])]);
    expect(limited.segments).toHaveLength(0);
    expect(limited.truncated).toBe(true);
    expect(limited.warnings?.[0]).toContain("accuracy");
    const closed = run([path([0, 0, 0, 2, 100, 0, 0, 100, 100, 100, 4])]);
    expect(closed.truncated).toBe(false);
    const counted = run([line(10), line(20), line(30)], { maxSegments: 2 });
    expect(counted.segments).toHaveLength(2);
    expect(counted.truncated).toBe(true);
    expect(run([line(10), line(20)], { maxOperators: 1 }).truncated).toBe(true);
  });

  it("tracks nested optional-content names and excludes hidden layers", () => {
    const result = run(
      [
        [PIPE_OPS.beginMarkedContentProps, ["OC", { id: "pipes" }]],
        line(10),
        [PIPE_OPS.beginMarkedContentProps, ["OC", { id: "hidden" }]],
        line(20),
        [PIPE_OPS.endMarkedContent, []],
        line(30),
        [PIPE_OPS.endMarkedContent, []],
        line(40),
      ],
      {
        resolveOptionalContent: (properties) => ({
          name:
            (properties as { id: string }).id === "pipes"
              ? "ST\u0000 piping"
              : "hidden",
          visible: (properties as { id: string }).id !== "hidden",
        }),
      },
    );
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]!.layer).toBe("ST piping");
    expect(result.segments[1]!.layer).toBe("ST piping");
    expect(result.segments[2]!.layer).toBeUndefined();
  });

  it("excludes unsupported nonrectangular clips instead of measuring invisible strokes", () => {
    const result = run([
      [PIPE_OPS.clip, []],
      path([0, 10, 10, 1, 90, 10, 1, 50, 90, 4], PIPE_OPS.endPath),
      line(50),
    ]);
    expect(result.segments).toEqual([]);
    expect(result.warnings?.[0]).toContain("clipped");
    expect(result.truncated).toBe(true);
  });
});

describe("embedded pipe labels", () => {
  it("recognizes sized system codes while respecting word boundaries", () => {
    expect(pipeSystemTokens('100mm ST / 4" SAN; CW; HW; HWR')).toEqual([
      "ST",
      "SAN",
      "CW",
      "HW",
      "HWR",
    ]);
    expect(pipeSystemTokens("STORM SANITARY")).toEqual(["ST", "SAN"]);
    expect(pipeSystemTokens("WEST STATUS SANDBOX SHOW CWS ST-01")).toEqual([
      "ST",
    ]);
  });

  it("projects rotated text boxes to the same viewport and joins adjacent split glyphs", () => {
    const rotate = (x: number, y: number) => ({ x: 1 - y / 100, y: x / 100 });
    const result = pipeLabelsFromTextItems(
      [
        text("100mm ST", 10, 20, 30),
        text("S", 10, 50, 3),
        text("T", 13.5, 50, 3),
      ],
      rotate,
    );
    expect(result.labels[0]).toMatchObject({
      system: "ST",
      left: 0.75,
      top: 0.1,
      right: 0.8,
      bottom: 0.4,
      direction: { x: 0, y: expect.closeTo(0.3) },
    });
    expect(result.labels[1]).toMatchObject({ text: "ST", system: "ST" });
    expect(result.labels[1]!.direction!.x).toBeCloseTo(0);
    expect(result.labels[1]!.direction!.y).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it("ignores malformed/off-page text and bounds item and label scans", () => {
    expect(
      pipeLabelsFromTextItems(
        [
          { str: "ST", transform: [NaN, 0, 0, 1, 0, 0], width: 1, height: 1 },
          text("ST", 200),
        ],
        toSheet,
      ).labels,
    ).toEqual([]);
    const result = pipeLabelsFromTextItems([text("ST"), text("SAN")], toSheet, {
      maxLabels: 1,
    });
    expect(result.labels).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(
      pipeLabelsFromTextItems([text("ST"), text("SAN")], toSheet, {
        maxItems: 1,
      }).truncated,
    ).toBe(true);
  });
});

describe("pipe PDF loader", () => {
  it("loads saved upload geometry without downloading or parsing the PDF again", async () => {
    const saved = { segments: [], labels: [], symbols: [], texts: [], componentDataVersion: 1, aspect: 0.5, truncated: false };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 1, linework: saved })));
    vi.stubGlobal("fetch", fetcher);
    const before = pdf.load.mock.calls.length;
    try {
      const url = "/api/job-rooms/files/0391aed4-7773-47ec-9141-09df373ec008/d814fc88-da7c-4df5-aa89-fe3c1fde0462/plan.pdf";
      expect(await loadPipeLinework({ url, page: 10 })).toEqual(saved);
      expect(fetcher.mock.calls[0]?.[0]).toBe(url.replace("plan.pdf", "pipes-10-v1.json"));
      expect(pdf.load.mock.calls.length).toBe(before);
      fetcher.mockResolvedValue(new Response(null, { status: 403 }));
      await expect(loadPipeLinework({ url, page: 10 })).rejects.toThrow("access denied");
      expect(pdf.load.mock.calls.length).toBe(before);
    } finally { vi.unstubAllGlobals(); }
  });
  it("uses shared document lifecycle, disables imported annotations, and loads no raster interpretation", async () => {
    const getOperatorList = vi.fn(async () => ({
      fnArray: [PIPE_OPS.constructPath],
      argsArray: [
        [PIPE_OPS.stroke, [Float32Array.from([0, 10, 20, 1, 90, 20])]],
      ],
    }));
    pdf.library.mockResolvedValue({
      OPS: PIPE_OPS,
      AnnotationMode: { DISABLE: 0 },
    });
    pdf.load.mockResolvedValue({
      getPage: async () => ({
        getViewport: () => ({
          width: 100,
          height: 100,
          convertToViewportPoint: (x: number, y: number) => [x, y],
        }),
        getOperatorList,
        getTextContent: async () => ({ items: [text("100mm ST")] }),
      }),
      getOptionalContentConfig: async () => ({
        isVisible: () => true,
        getGroup: () => null,
      }),
    });
    const result = await loadPipeLinework({
      url: "/private-plan.pdf",
      page: 1,
    });
    expect(pdf.load).toHaveBeenCalledWith("/private-plan.pdf");
    expect(getOperatorList).toHaveBeenCalledWith({ annotationMode: 0 });
    expect(result.segments).toHaveLength(1);
    expect(result.labels[0]!.system).toBe("ST");
  });

  it("honors cancellation before reading a private PDF", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadPipeLinework({
        url: "/private-plan.pdf",
        page: 1,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects a cancelled request after the shared PDF finishes loading", async () => {
    const controller = new AbortController();
    pdf.library.mockResolvedValue({
      OPS: PIPE_OPS,
      AnnotationMode: { DISABLE: 0 },
    });
    pdf.load.mockImplementation(async () => {
      controller.abort();
      return {};
    });
    await expect(
      loadPipeLinework({
        url: "/private-plan.pdf",
        page: 1,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

it('retains closed curved symbol geometry separately without adding it to measured strokes',()=>{
 const result=run([path([0,40,40,2,42,40,42,42,40,42,4]),line(50)]);
 expect(result.symbols).toHaveLength(1);
 expect(result.symbols?.[0]).toMatchObject({closed:true});
 expect(result.segments).toHaveLength(1);
 expect(result.componentDataVersion).toBe(2);
 expect(pipeLabelsFromTextItems([text('BALL VALVE')],toSheet).texts[0]).toMatchObject({text:'BALL VALVE'});
});

it('reparses older cached geometry that has no component symbols/text',async()=>{
 const url='/api/job-rooms/files/0391aed4-7773-47ec-9141-09df373ec008/d814fc88-da7c-4df5-aa89-fe3c1fde0462/plan.pdf';
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({version:1,linework:{segments:[],labels:[],aspect:1,truncated:false}})));
 vi.stubGlobal('fetch',fetcher);
 pdf.library.mockResolvedValue({OPS:PIPE_OPS,AnnotationMode:{DISABLE:0}});
 pdf.load.mockResolvedValue({getPage:async()=>({getViewport:()=>({width:100,height:100,convertToViewportPoint:(x:number,y:number)=>[x,y]}),getOperatorList:async()=>({fnArray:[],argsArray:[]}),getTextContent:async()=>({items:[text('BALL VALVE')]})}),getOptionalContentConfig:async()=>({isVisible:()=>true,getGroup:()=>null})});
 try{
  const result=await loadPipeLinework({url,page:1});
  expect(pdf.load).toHaveBeenLastCalledWith(url);
  expect(result.texts?.[0]?.text).toBe('BALL VALVE');
  expect(result.componentDataVersion).toBe(2);
 }finally{vi.unstubAllGlobals();}
});

it('reserves symbol capacity fairly for later layers with arbitrary names',()=>{
 const square=()=>path([0,40,40,1,40.2,40,1,40.2,40.2,1,40,40.2,4]);
 const ops:Array<[number,unknown[]]>=[
  [PIPE_OPS.beginMarkedContentProps,['OC',{id:'Dense random layer'}]],
  ...Array.from({length:15010},square),[PIPE_OPS.endMarkedContent,[]],
  [PIPE_OPS.beginMarkedContentProps,['OC',{id:'Later random layer'}]],square(),[PIPE_OPS.endMarkedContent,[]],
 ];
 const result=run(ops,{resolveOptionalContent:p=>({name:(p as {id:string}).id,visible:true})});
 expect(result.symbols?.some(p=>p.layer==='Later random layer')).toBe(true);
 expect(result.symbols!.length).toBeLessThanOrEqual(15000);
 expect(result.symbols!.reduce((n,p)=>n+p.points.length,0)).toBeLessThanOrEqual(200000);
 expect(result.componentDataPartial).toBe(true);
});
