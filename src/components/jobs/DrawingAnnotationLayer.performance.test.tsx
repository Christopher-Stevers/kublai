import { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingEntity, DrawingMarkup } from "~/lib/drawing-workspace";
import type * as AnnotationSvgModule from "./DrawingAnnotationSvg";
import { DrawingAnnotationLayer } from "./DrawingAnnotationLayer";

const { draw } = vi.hoisted(() => ({ draw: vi.fn() }));
vi.mock("./DrawingAnnotationSvg", async (importOriginal) => {
  const original = await importOriginal<typeof AnnotationSvgModule>();
  return {
    DrawingAnnotationSvg: (
      props: Parameters<typeof original.DrawingAnnotationSvg>[0],
    ) => {
      draw(props.data);
      return original.DrawingAnnotationSvg(props);
    },
  };
});
function markup(
  id: string,
  changes: Partial<DrawingMarkup> = {},
): DrawingEntity {
  return {
    id,
    sheetId: "sheet",
    kind: "markup",
    revision: 1,
    visibility: "published",
    authorId: "user",
    authorName: "Tim",
    createdAt: "",
    updatedAt: "",
    comments: [],
    data: {
      sourceSheetId: "sheet",
      type: "freehand",
      points: Array.from({ length: 500 }, (_, i) => ({ x: i / 1000, y: 0.5 })),
      stroke: "#ef4444",
      width: 2,
      ...changes,
    },
  };
}
beforeEach(() => draw.mockClear());
afterEach(cleanup);

describe("saved markup reuse during gestures", () => {
  it("reuses saved geometry when zooming, panning or drawing a new stroke", () => {
    const annotations = Array.from({ length: 30 }, (_, i) =>
      markup(`ink-${i}`),
    );
    const props = { annotations, aspect: 0.5, screenPixelSize: 2 };
    const { rerender } = render(<DrawingAnnotationLayer {...props} />);
    expect(draw).toHaveBeenCalledTimes(30);
    draw.mockClear();
    rerender(<DrawingAnnotationLayer {...props} screenPixelSize={0.5} />);
    rerender(
      <DrawingAnnotationLayer
        {...props}
        annotations={[...annotations]}
        screenPixelSize={0.5}
      />,
    );
    expect(draw).not.toHaveBeenCalled();
    const draft = {
      ...(annotations[0] as Extract<DrawingEntity, { kind: "markup" }>).data,
      points: [{ x: 0.1, y: 0.2 }],
    };
    rerender(<DrawingAnnotationLayer {...props} draft={draft} />);
    expect(draw).toHaveBeenCalledExactlyOnceWith(draft);
  });

  it("updates screen-sized handles, pins and measuring runs without rebuilding ordinary ink", () => {
    const ink = markup("ink");
    const measure = markup("measure", {
      type: "dimension",
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.4, y: 0.2 },
      ],
      parents: [null, 0],
    });
    const issue: DrawingEntity = {
      ...ink,
      id: "pin",
      kind: "issue",
      data: {
        sourceSheetId: "sheet",
        type: "issue",
        title: "Check this",
        body: "",
        assigneeId: null,
        dueDate: null,
        links: [],
        point: { x: 0.2, y: 0.3 },
        status: "open",
      },
    };
    const props = {
      annotations: [ink, measure, issue],
      aspect: 0.5,
      selectedId: "ink",
      screenPixelSize: 2,
    };
    const { container, rerender } = render(
      <DrawingAnnotationLayer {...props} />,
    );
    draw.mockClear();
    rerender(<DrawingAnnotationLayer {...props} screenPixelSize={0.5} />);
    expect(draw).toHaveBeenCalledExactlyOnceWith(
      (measure as Extract<DrawingEntity, { kind: "markup" }>).data,
    );
    expect(
      container.querySelector('[data-annotation-handle="nw"] circle'),
    ).toHaveAttribute("r", "9");
    expect(
      container.querySelector('[data-annotation-id="pin"] g'),
    ).toHaveAttribute("transform", "translate(200 150) scale(0.5)");
  });

  it("redraws just the edited shape and applies remote revisions, visibility, and permission changes", () => {
    const first = markup("first", {
      type: "rect",
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.4, y: 0.4 },
      ],
    });
    const second = markup("second");
    const props = {
      annotations: [first, second],
      aspect: 0.5,
      selectedId: "first",
    };
    const { container, rerender } = render(
      <DrawingAnnotationLayer {...props} canEditAnnotation={() => true} />,
    );
    draw.mockClear();
    const edited = {
      ...(first as Extract<DrawingEntity, { kind: "markup" }>).data,
      stroke: "#2563eb",
    };
    rerender(
      <DrawingAnnotationLayer
        {...props}
        editing={{ id: "first", data: edited }}
        canEditAnnotation={() => false}
      />,
    );
    expect(draw).toHaveBeenCalledExactlyOnceWith(edited);
    expect(container.querySelector("[data-annotation-handle]")).toBeNull();
    draw.mockClear();
    const updated = { ...first, revision: 2, data: edited } as DrawingEntity;
    rerender(
      <DrawingAnnotationLayer
        {...props}
        annotations={[updated, { ...second, visibility: "archived" }]}
        hidden
      />,
    );
    expect(container.querySelector("[data-annotation-id]")).toBeNull();
    rerender(
      <DrawingAnnotationLayer
        {...props}
        annotations={[updated, { ...second, visibility: "archived" }]}
      />,
    );
    expect(container.querySelector('[data-annotation-id="second"]')).toBeNull();
    expect(
      container.querySelector('[data-annotation-id="first"] rect'),
    ).toHaveAttribute("stroke", "#2563eb");
  });

  it("uses the latest keyboard selection and link callbacks after memoized updates", () => {
    const link = markup("link", {
      type: "link",
      href: "https://example.com",
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.4, y: 0.4 },
      ],
    });
    const oldSelect = vi.fn(),
      newSelect = vi.fn(),
      oldActivate = vi.fn(),
      newActivate = vi.fn();
    const props = { annotations: [link], aspect: 0.5 };
    const { container, rerender } = render(
      <DrawingAnnotationLayer {...props} onSelect={oldSelect} />,
    );
    const target = container.querySelector('[data-annotation-id="link"]')!;
    rerender(<DrawingAnnotationLayer {...props} onSelect={newSelect} />);
    fireEvent.keyDown(target, { key: "Enter" });
    expect(newSelect).toHaveBeenCalledWith("link");
    expect(oldSelect).not.toHaveBeenCalled();
    rerender(<DrawingAnnotationLayer {...props} onActivate={oldActivate} />);
    rerender(<DrawingAnnotationLayer {...props} onActivate={newActivate} />);
    fireEvent.keyDown(target, { key: " " });
    expect(newActivate).toHaveBeenCalledOnce();
    expect(oldActivate).not.toHaveBeenCalled();
  });
});

it("paints draft and captured edits independently without remounting tap targets on selection", () => {
  const annotations = [markup("one"), markup("two")];
  const viewportRef = createRef<SVGSVGElement>(),
    activeViewportRef = createRef<SVGSVGElement>();
  const props = {
    annotations,
    aspect: 0.75,
    bufferedViewport: true,
    viewportRef,
    activeViewportRef,
  };
  const { container, rerender } = render(<DrawingAnnotationLayer {...props} />);
  const target = container.querySelector('[data-annotation-id="one"]');
  expect(activeViewportRef.current).toBeNull();
  rerender(<DrawingAnnotationLayer {...props} selectedId="one" heldId="one" />);
  expect(container.querySelector('[data-annotation-id="one"]')).toBe(target);
  const data = (annotations[0] as Extract<DrawingEntity, { kind: "markup" }>)
    .data;
  draw.mockClear();
  rerender(<DrawingAnnotationLayer {...props} selectedId="one" draft={data} />);
  expect(draw).toHaveBeenCalledExactlyOnceWith(data);
  expect(activeViewportRef.current?.parentElement).not.toBe(
    viewportRef.current?.parentElement,
  );
  expect(
    viewportRef.current?.querySelectorAll("[data-annotation-id]"),
  ).toHaveLength(2);
  const editing = { id: "one", data: { ...data, stroke: "#9333ea" } };
  rerender(
    <DrawingAnnotationLayer {...props} selectedId="one" editing={editing} />,
  );
  expect(
    viewportRef.current?.querySelectorAll("[data-annotation-id]"),
  ).toHaveLength(1);
  expect(
    activeViewportRef.current?.querySelectorAll("[data-annotation-id]"),
  ).toHaveLength(1);
  expect(
    activeViewportRef.current?.querySelector(".annotation-shake"),
  ).toBeNull();
  rerender(<DrawingAnnotationLayer {...props} selectedId="one" />);
  expect(activeViewportRef.current).toBeNull();
  expect(container.querySelector('[data-annotation-id="one"]')).not.toHaveClass(
    "annotation-shake",
  );
  expect(
    viewportRef.current?.querySelectorAll("[data-annotation-id]"),
  ).toHaveLength(2);
});

it("reuses measurement labels between zoom steps and restores exact screen sizes on settle", () => {
  const measure = markup("measure", {
    type: "dimension",
    points: [
      { x: 0.1, y: 0.2 },
      { x: 0.4, y: 0.2 },
    ],
    parents: [null, 0],
  });
  const props = { annotations: [measure], aspect: 0.75, screenPixelSize: 1 };
  const { container, rerender } = render(<DrawingAnnotationLayer {...props} />);
  const label = () =>
    container.querySelector("[data-measurement-segment] text");
  const initial = label()?.getAttribute("font-size");
  draw.mockClear();
  for (const size of [0.95, 0.9, 0.85, 0.8])
    rerender(
      <DrawingAnnotationLayer {...props} moving screenPixelSize={size} />,
    );
  expect(draw).not.toHaveBeenCalled();
  expect(label()?.getAttribute("font-size")).toBe(initial);
  rerender(<DrawingAnnotationLayer {...props} screenPixelSize={0.8} />);
  expect(draw).toHaveBeenCalledOnce();
  expect(Number(label()?.getAttribute("font-size"))).toBeCloseTo(
    Number(initial) * 0.8,
  );
});
