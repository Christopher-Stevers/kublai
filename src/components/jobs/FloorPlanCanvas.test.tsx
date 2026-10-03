import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { polygonPathAttr, type RoomPolygonShape } from "~/lib/room-shape";
import { FloorPlanCanvas } from "./FloorPlanCanvas";
import { roomReviewTransform } from "~/lib/floor-plan-viewport";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("room tracing overlay", () => {
  it("shows excluded courtyards and columns as holes in the saved trace preview", () => {
    const shape: RoomPolygonShape = {
      type: "polygon",
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
      holes: [
        [
          { x: 0.4, y: 0.4 },
          { x: 0.6, y: 0.4 },
          { x: 0.6, y: 0.6 },
          { x: 0.4, y: 0.6 },
        ],
      ],
    };
    const { container } = render(
      <FloorPlanCanvas
        imageUrl="/plan.png"
        rooms={[]}
        canEdit
        onSelectRoom={vi.fn()}
        previewShape={shape}
      />,
    );
    const preview = container.querySelector("[data-trace-preview]");
    expect(preview?.tagName.toLowerCase()).toBe("path");
    expect(preview).toHaveAttribute("d", polygonPathAttr(shape));
    expect(preview).toHaveAttribute("fill-rule", "evenodd");
  });

  it("brings the next review room into view when the image loads and selection changes", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(350);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(260);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(640);
    const rooms = [
      {
        id: "left",
        name: "Left room",
        confirmed: false,
        shape: { type: "bbox" as const, x: 0.1, y: 0.2, w: 0.15, h: 0.2 },
      },
      {
        id: "right",
        name: "Right room",
        confirmed: false,
        shape: { type: "bbox" as const, x: 0.75, y: 0.65, w: 0.15, h: 0.2 },
      },
    ];
    const props = {
      imageUrl: "/plan.png",
      rooms,
      canEdit: false,
      onSelectRoom: vi.fn(),
    };
    const { getByAltText, rerender } = render(
      <FloorPlanCanvas {...props} focusRoomId="left" />,
    );
    const image = getByAltText("Floor plan");
    fireEvent.load(image);
    const layer = image.parentElement!.parentElement!;
    const first = layer.style.transform;
    rerender(<FloorPlanCanvas {...props} focusRoomId="right" />);
    fireEvent.load(image);
    const expected = roomReviewTransform(
      rooms[1]!.shape,
      { width: 350, height: 260 },
      { width: 360, height: 640 },
    )!;
    const actual = layer.style.transform.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(actual[0]).toBeCloseTo(expected.tx);
    expect(actual[1]).toBeCloseTo(expected.ty);
    expect(actual[2]).toBeCloseTo(expected.scale);
    expect(layer.style.transform).not.toBe(first);
  });
});


describe("drawing double tap", () => {
  function setup(extra = {}) {
    vi.useFakeTimers();
    const onSelectRoom = vi.fn();
    const result = render(<FloorPlanCanvas imageUrl="/plan.png" canEdit={false}
      rooms={[{ id: "room", name: "Room", confirmed: false,
        shape: { type: "bbox", x: 0, y: 0, w: 1, h: 1 } }]}
      onSelectRoom={onSelectRoom} {...extra} />);
    const image = result.getByAltText("Floor plan");
    const plan = image.parentElement!;
    const layer = plan.parentElement!;
    const viewport = layer.parentElement!;
    const rect = { left: 20, top: 80, width: 300, height: 400, right: 320, bottom: 480, x: 20, y: 80, toJSON() { return {}; } };
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(rect);
    vi.spyOn(plan, "getBoundingClientRect").mockReturnValue(rect);
    return { ...result, layer, onSelectRoom, svg: result.container.querySelector("svg")! };
  }

  it("zooms around the tapped point without opening the room, including with a header offset", () => {
    const { svg, layer, onSelectRoom } = setup();
    fireEvent.click(svg, { clientX: 120, clientY: 180 });
    vi.advanceTimersByTime(100);
    fireEvent.click(svg, { clientX: 120, clientY: 180 });
    expect(layer.style.transform).toBe("translate(-100px, -100px) scale(2)");
    vi.advanceTimersByTime(500);
    expect(onSelectRoom).not.toHaveBeenCalled();
  });

  it("still opens a room on a single tap", () => {
    const { svg, onSelectRoom } = setup();
    fireEvent.click(svg, { clientX: 120, clientY: 180 });
    vi.advanceTimersByTime(301);
    expect(onSelectRoom).toHaveBeenCalledExactlyOnceWith("room");
  });

  it("does not zoom when taps are far apart or while tracing", () => {
    const { svg, layer, unmount } = setup();
    fireEvent.click(svg, { clientX: 60, clientY: 120 });
    fireEvent.click(svg, { clientX: 240, clientY: 300 });
    expect(layer.style.transform).toContain("scale(1)");
    unmount();
    const tracing = setup({ detectMode: true });
    fireEvent.click(tracing.svg, { clientX: 120, clientY: 180 });
    fireEvent.click(tracing.svg, { clientX: 120, clientY: 180 });
    expect(tracing.layer.style.transform).toContain("scale(1)");
  });
});
