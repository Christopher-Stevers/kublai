import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { polygonPathAttr, type RoomPolygonShape } from "~/lib/room-shape";
import { FloorPlanCanvas } from "./FloorPlanCanvas";
import { roomReviewTransform } from "~/lib/floor-plan-viewport";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
