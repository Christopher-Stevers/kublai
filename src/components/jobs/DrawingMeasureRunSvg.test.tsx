import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DrawingMeasureRunSvg } from "./DrawingMeasureRunSvg";

afterEach(cleanup);
it.each([1, 12])(
  "keeps endpoint fades local without clipping thick or horizontal runs (width %s)",
  (width) => {
    const { container } = render(
      <svg>
        <DrawingMeasureRunSvg
          data={{
            sourceSheetId: "sheet",
            type: "dimension",
            stroke: "#16a34a",
            width,
            points: [
              { x: 0.2, y: 0.4 },
              { x: 0.25, y: 0.4 },
            ],
            parents: [null, 0],
          }}
          aspect={0.75}
          screenPixelSize={0.1}
          sheetPixelSize={1}
          sharedScale={{ unit: "m", unitsPerSheetWidth: 100 }}
        />
      </svg>,
    );
    // Endpoint fades must not clip even a thick, horizontal line. No offscreen
    // masks/filters are needed, so dense sheets can stay on the vector fast path.
    expect(container.querySelector("mask, filter, clipPath")).toBeNull();
    const path = container.querySelector("[data-saved-measure-path]")!;
    expect(path.getAttribute("d")).toMatch(/M 20[0-9.]+ 300 L 24[0-9.]+ 300/);
    expect(Number(path.getAttribute("stroke-width"))).toBeGreaterThan(0);
    expect(
      container.querySelector("[data-measurement-segment]"),
    ).toHaveTextContent("5 m");
    expect(
      container.querySelectorAll("[data-saved-measure-node]"),
    ).toHaveLength(2);
    expect(container.querySelectorAll("[data-measure-dot]")).toHaveLength(2);
  },
);
