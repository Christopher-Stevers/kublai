import type { SheetPoint } from "./sheet-measure";
import type { SnapSegment } from "./sheet-snap";

export type MeasureRunNode = {
  point: SheetPoint;
  line: SnapSegment | null;
  parent: number | null;
  /** Restored directions are angle references, not finite PDF snapping targets. */
  referenceOnly?: boolean;
};
type Snapshot = {
  nodes: MeasureRunNode[];
  active: number | null;
  branching: boolean;
};
export type MeasureRun = Snapshot & { history: Snapshot[]; future: Snapshot[] };
export type RunHit = {
  point: SheetPoint;
  from: number;
  to: number;
  node: number | null;
};
export const MAX_MEASURE_NODES = 400;
export const emptyMeasureRun = (): MeasureRun => ({
  nodes: [],
  active: null,
  branching: false,
  history: [],
  future: [],
});
export type RunAction =
  | { type: "load"; nodes: MeasureRunNode[] }
  | { type: "append"; point: SheetPoint; line: SnapSegment | null }
  | { type: "select"; index: number }
  | { type: "branch"; hit: RunHit }
  | { type: "move"; index: number; point: SheetPoint; line: SnapSegment | null }
  | { type: "undo" | "redo" | "clear" | "forget-lines" };

function save(run: MeasureRun, next: Snapshot): MeasureRun {
  return {
    ...next,
    future: [],
    history: [
      ...run.history,
      { nodes: run.nodes, active: run.active, branching: run.branching },
    ].slice(-MAX_MEASURE_NODES * 2),
  };
}

/** Splitting an edge preserves its length; switching tips adds no jump back to the trunk. */
export function measureRunReducer(
  run: MeasureRun,
  action: RunAction,
): MeasureRun {
  switch (action.type) {
    case "load":
      return {
        nodes: action.nodes,
        active: action.nodes.length - 1,
        branching: false,
        history: [],
  future: [],
      };
    case "clear":
      return emptyMeasureRun();
    case "forget-lines": {
      const clear = (nodes: MeasureRunNode[]) =>
        nodes.map((node) => ({
          ...node,
          line: node.referenceOnly ? node.line : null,
        }));
      return {
        ...run,
        nodes: clear(run.nodes),
        future: run.future.map((snapshot) => ({ ...snapshot, nodes: clear(snapshot.nodes) })),
        history: run.history.map((snapshot) => ({
          ...snapshot,
          nodes: clear(snapshot.nodes),
        })),
      };
    }
    case "undo": {
      const previous = run.history.at(-1);
      return previous
        ? { ...previous, history: run.history.slice(0, -1), future: [{ nodes: run.nodes, active: run.active, branching: run.branching }, ...run.future] }
        : run;
    }
    case "redo": {
      const next = run.future[0];
      return next ? { ...next, future: run.future.slice(1), history: [...run.history, { nodes: run.nodes, active: run.active, branching: run.branching }] } : run;
    }
    case "append": {
      const anchor =
        run.active === null ? undefined : run.nodes[run.active]?.point;
      if (
        run.branching &&
        anchor &&
        Math.hypot(action.point.x - anchor.x, action.point.y - anchor.y) < 1e-9
      )
        return run;
      if (run.nodes.length >= MAX_MEASURE_NODES) return run;
      return save(run, {
        nodes: [
          ...run.nodes,
          { point: action.point, line: action.line, parent: run.active },
        ],
        active: run.nodes.length,
        branching: false,
      });
    }
    case "select": {
      const node = run.nodes[action.index];
      if (!node || run.active === action.index) return run;
      const neighbor = node.parent === null
        ? run.nodes.find(candidate => candidate.parent === action.index)
        : run.nodes[node.parent];
      return save(run, {
        nodes: run.nodes.map((candidate, index) => index === action.index && !candidate.line && neighbor
          ? { ...candidate, line: { x1: neighbor.point.x, y1: neighbor.point.y, x2: node.point.x, y2: node.point.y }, referenceOnly: true }
          : candidate),
        active: action.index,
        branching: false,
      });
    }
    case "move": {
      if (!run.nodes[action.index]) return run;
      return save(run, {
        nodes: run.nodes.map((node, index) =>
          index === action.index
            ? {
                ...node,
                point: action.point,
                line: action.line,
                referenceOnly: false,
              }
            : node,
        ),
        active: run.active,
        branching: run.branching,
      });
    }
    case "branch": {
      const { hit } = action;
      const from = run.nodes[hit.from],
        to = run.nodes[hit.to];
      if (!from || to?.parent !== hit.from) return run;
      const line = {
        x1: from.point.x,
        y1: from.point.y,
        x2: to.point.x,
        y2: to.point.y,
      };
      if (hit.node !== null) {
        if (hit.node !== hit.from && hit.node !== hit.to) return run;
        return save(run, {
          nodes: run.nodes.map((node, index) =>
            index === hit.node && !node.line
              ? { ...node, line, referenceOnly: true }
              : node,
          ),
          active: hit.node,
          branching: true,
        });
      }
      if (run.nodes.length >= MAX_MEASURE_NODES) return run;
      const index = run.nodes.length;
      const nodes = run.nodes.map((node, id) =>
        id === hit.to ? { ...node, parent: index } : node,
      );
      nodes.push({
        point: hit.point,
        line,
        parent: hit.from,
        referenceOnly: true,
      });
      return save(run, { nodes, active: index, branching: true });
    }
  }
}

/** Screen tolerance is converted to sheet widths by the viewer; y uses real sheet aspect. */
export function hitMeasureRun(
  nodes: readonly MeasureRunNode[],
  point: SheetPoint,
  aspect: number,
  tolerance: number,
): RunHit | null {
  if (!(aspect > 0 && tolerance > 0)) return null;
  let hit: RunHit | null = null;
  let nearest = tolerance;
  nodes.forEach((end, to) => {
    const from = end.parent;
    if (from === null) return;
    const start = nodes[from];
    if (!start) return;
    const dx = end.point.x - start.point.x,
      dy = (end.point.y - start.point.y) * aspect;
    const squared = dx * dx + dy * dy;
    if (squared < 1e-18) return;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x - start.point.x) * dx +
          (point.y - start.point.y) * aspect * dy) /
          squared,
      ),
    );
    const projected = {
      x: start.point.x + t * dx,
      y: start.point.y + (t * dy) / aspect,
    };
    const distance = Math.hypot(
      point.x - projected.x,
      (point.y - projected.y) * aspect,
    );
    if (distance > nearest) return;
    nearest = distance;
    hit = {
      point: projected,
      from,
      to,
      node: t <= 1e-8 ? from : t >= 1 - 1e-8 ? to : null,
    };
  });
  return hit;
}

/** Sum graph edges once, including preview/drag geometry supplied by the viewer. */
export function measureRunWidths(
  nodes: readonly { point: SheetPoint; parent?: number | null }[],
  aspect: number,
): number {
  return nodes.reduce((total, node, index) => {
    const parent = node.parent === undefined ? index - 1 : node.parent;
    const start = parent === null ? undefined : nodes[parent];
    return start
      ? total +
          Math.hypot(
            node.point.x - start.point.x,
            (node.point.y - start.point.y) * aspect,
          )
      : total;
  }, 0);
}

/** Angle references follow graph connectivity rather than array insertion order. */
export function runAngleReference(
  nodes: readonly {
    point: SheetPoint;
    line: SnapSegment | null;
    parent?: number | null;
  }[],
  endIndex: number,
  active: number | null,
) {
  const parentOf = (index: number) =>
    nodes[index]?.parent === undefined ? index - 1 : nodes[index].parent;
  let anchorIndex = endIndex === nodes.length ? active : parentOf(endIndex);
  let previousIndex: number | null | undefined;
  if (anchorIndex === null || anchorIndex === undefined || anchorIndex < 0) {
    anchorIndex = nodes.findIndex((_, index) => parentOf(index) === endIndex);
    previousIndex = nodes.findIndex(
      (_, index) => parentOf(index) === anchorIndex,
    );
  } else previousIndex = parentOf(anchorIndex);
  const anchor = nodes[anchorIndex];
  if (!anchor) return null;
  const previous =
    previousIndex == null ? undefined : nodes[previousIndex]?.point;
  const reference =
    previous &&
    Math.hypot(previous.x - anchor.point.x, previous.y - anchor.point.y) > 1e-9
      ? {
          x1: previous.x,
          y1: previous.y,
          x2: anchor.point.x,
          y2: anchor.point.y,
        }
      : anchor.line;
  return { anchorIndex, anchor: anchor.point, reference, previous };
}
