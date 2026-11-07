import { Profiler, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DrawingAnnotationLayer } from "../../../src/components/jobs/DrawingAnnotationLayer";
import { paintDrawingAnnotationCamera } from "../../../src/lib/drawing-annotation-camera";
import type {
  DrawingEntity,
  DrawingMarkup,
} from "../../../src/lib/drawing-workspace";
const params = new URLSearchParams(location.search);
const count = Math.min(2000, Math.max(1, Number(params.get("count") ?? 600)));
const columns = Math.ceil(Math.sqrt(count * 1.5)),
  rows = Math.ceil(count / columns);
const annotations: DrawingEntity[] = Array.from({ length: count }, (_, i) => {
  const x = 0.03 + ((i % columns) * 0.94) / columns,
    y = 0.04 + (Math.floor(i / columns) * 0.86) / rows;
  return {
    id: String(i),
    kind: "markup",
    visibility: "published",
    revision: 1,
    sheetId: "test",
    authorId: "test",
    authorName: "Fixture",
    createdAt: "",
    updatedAt: "",
    comments: [],
    data: {
      sourceSheetId: "test",
      type: i % 3 ? "dimension" : "freehand",
      points:
        i % 3
          ? [
              { x, y },
              { x: x + 0.018, y: y + 0.017 },
              { x: x + 0.027, y: y - 0.005 },
            ]
          : Array.from({ length: 60 }, (_, j) => ({
              x: x + j * 0.0005,
              y: y + Math.sin(j / 5) * 0.008,
            })),
      ...(i % 3
        ? { parents: [null, 0, 1], scale: 100, unit: "m" as const }
        : {}),
      stroke: ["#2563eb", "#ef4444", "#059669"][i % 3]!,
      width: 2,
    },
  };
});
const phone = params.get("frame") === "phone";
const fit = { width: phone ? 390 : 1000, height: phone ? 292.5 : 750 },
  size = { width: fit.width, height: phone ? 600 : 800 };
const initial = { x: 0, y: 0, scale: 1 };
type Mode = "pan" | "zoom" | "draw" | "move";
let reactMs = 0,
  commits = 0;
function App() {
  const [view, setView] = useState(initial),
    [moving, setMoving] = useState(false);
  const [draft, setDraft] = useState<DrawingMarkup | null>(null),
    [editing, setEditing] = useState<{
      id: string;
      data: DrawingMarkup;
    } | null>(null);
  const [result, setResult] = useState<Record<string, string | number> | null>(
    null,
  );
  const [selected, setSelected] = useState<string | null>(null),
    [running, setRunning] = useState(false);
  const active = useRef<SVGSVGElement>(null),
    svg = useRef<SVGSVGElement>(null),
    live = useRef(initial),
    isMoving = useRef(false);
  const paint = () => {
    paintDrawingAnnotationCamera(
      svg.current,
      fit,
      size,
      live.current,
      isMoving.current,
    );
    paintDrawingAnnotationCamera(
      active.current,
      fit,
      size,
      live.current,
      false,
      false,
    );
  };
  useLayoutEffect(paint);
  async function run(mode: Mode) {
    if (running) return;
    setRunning(true);
    setResult(null);
    reactMs = 0;
    commits = 0;
    const gaps: number[] = [];
    let last = 0;
    const start = performance.now();
    isMoving.current = mode === "pan" || mode === "zoom";
    setMoving(isMoving.current);
    for (let i = 0; i < 120; i++) {
      const timestamp = await new Promise<number>(requestAnimationFrame);
      if (last) gaps.push(timestamp - last);
      last = timestamp;
      const t = i / 119;
      live.current =
        mode === "zoom"
          ? { x: 0, y: 0, scale: 1 + 7 * Math.sin(Math.PI * t) }
          : {
              x: Math.sin(t * Math.PI * 4) * fit.width * 0.3,
              y: Math.cos(t * Math.PI * 2) * size.height * 0.2,
              scale: 1,
            };
      if (mode === "draw" || mode === "move") {
        live.current = initial;
        const data: DrawingMarkup = {
          sourceSheetId: "test",
          type: "freehand",
          points: Array.from({ length: 100 }, (_, j) => ({
            x: 0.3 + j * 0.003,
            y: 0.45 + Math.sin(j / 10 + t * 5) * 0.02,
          })),
          stroke: "#9333ea",
          width: 3,
        };
        if (mode === "draw") setDraft(data);
        else setEditing({ id: "0", data });
      }
      if (i % 3 === 0) setView(live.current);
      paint();
    }
    isMoving.current = false;
    setMoving(false);
    live.current = initial;
    setView(initial);
    setDraft(null);
    setEditing(null);
    paint();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const sorted = [...gaps].sort((a, b) => a - b);
    setResult({
      mode,
      count,
      frame: phone ? "phone" : "desktop",
      dpr: devicePixelRatio,
      dom: document.querySelectorAll('[aria-label="Drawing annotations"] *')
        .length,
      reactMs: Math.round(reactMs),
      commits,
      p50: Math.round(sorted[Math.floor(sorted.length * 0.5)]! * 10) / 10,
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]! * 10) / 10,
      over33: gaps.filter((x) => x > 34).length,
      over50: gaps.filter((x) => x > 51).length,
      ms: Math.round(performance.now() - start),
    });
    setRunning(false);
  }
  return (
    <>
      <header>
        <strong>Drawing benchmark · {count} markups</strong>{" "}
        {(["pan", "zoom", "draw", "move"] as const).map((mode) => (
          <button disabled={running} key={mode} onClick={() => void run(mode)}>
            Run {mode}
          </button>
        ))}{" "}
        <span>{running ? "Running…" : "Ready"}</span>
      </header>
      <pre role="status">{JSON.stringify(result)}</pre>
      <div id="frame" style={size}>
        <DrawingAnnotationLayer
          annotations={annotations}
          aspect={0.75}
          screenPixelSize={1000 / (fit.width * view.scale)}
          sheetPixelSize={1000 / fit.width}
          viewportRef={svg}
          activeViewportRef={active}
          bufferedViewport
          selectedId={selected}
          onSelect={setSelected}
          draft={draft}
          editing={editing}
          moving={moving}
        />
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <Profiler
    id="drawing"
    onRender={(_id, _phase, ms) => {
      reactMs += ms;
      commits++;
    }}
  >
    <App />
  </Profiler>,
);
