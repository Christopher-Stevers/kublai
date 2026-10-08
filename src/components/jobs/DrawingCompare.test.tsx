import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawingCompare } from "./DrawingCompare";
import { comparisonGeometry } from "./DrawingComparisonLayer";

vi.mock("./DrawingSheetViewer", () => ({
  DrawingSheetViewer: ({
    alt,
    comparison,
    src,
    pdf,
  }: {
    alt: string;
    src: string;
    pdf?: { url: string };
    comparison?: {
      src?: string;
      pdf?: { url: string };
      mode: string;
      alignment: { x: number; y: number; scale: number };
      primaryInk?: { color: string; opacity: number };
      secondaryInk?: { color: string; opacity: number };
    };
  }) => (
    <div
      data-testid="viewer"
      data-mode={comparison?.mode}
      data-alignment={JSON.stringify(comparison?.alignment)}
      data-src={src}
      data-pdf={pdf?.url}
      data-secondary={comparison?.src}
      data-secondary-pdf={comparison?.pdf?.url}
      data-inks={JSON.stringify([
        comparison?.primaryInk,
        comparison?.secondaryInk,
      ])}
    >
      {alt}
    </div>
  ),
}));
afterEach(cleanup);
const first = { id: "one", name: "Original", imageUrl: "/first.webp" };
const second = { id: "two", name: "Revision", imageUrl: "/second.webp" };

describe("drawing comparison", () => {
  it("passes independently chosen colours and opacities to the overlay and retains them across comparison modes", () => {
    render(<DrawingCompare first={first} second={second} />);
    fireEvent.change(screen.getByLabelText("Drawing A colour"), {
      target: { value: "#9333ea" },
    });
    fireEvent.change(screen.getByLabelText("Drawing B colour"), {
      target: { value: "#16a34a" },
    });
    fireEvent.change(screen.getByLabelText("Drawing A opacity"), {
      target: { value: "0.3" },
    });
    fireEvent.change(screen.getByLabelText("Drawing B opacity"), {
      target: { value: "0.6" },
    });
    const inks = JSON.stringify([
      { color: "#9333ea", opacity: 0.3 },
      { color: "#16a34a", opacity: 0.6 },
    ]);
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-inks", inks);
    fireEvent.change(screen.getByLabelText("Comparison mode"), {
      target: { value: "side-by-side" },
    });
    fireEvent.change(screen.getByLabelText("Comparison mode"), {
      target: { value: "overlay" },
    });
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-inks", inks);
  });
  it("resolves both private PDF and image sources before mounting and ignores a superseded response", async () => {
    let release!: () => void;
    const delay = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolveAssetUrl = vi.fn(async (url: string) => {
      if (url === first.imageUrl) await delay;
      return `blob:${url}`;
    });
    const firstPdf = { ...first, pdf: { url: "/first.pdf", page: 1 } };
    const secondPdf = { ...second, pdf: { url: "/second.pdf", page: 2 } };
    const view = render(
      <DrawingCompare
        first={firstPdf}
        second={secondPdf}
        resolveAssetUrl={resolveAssetUrl}
      />,
    );
    expect(screen.queryByTestId("viewer")).toBeNull();
    const replacement = {
      ...firstPdf,
      id: "third",
      imageUrl: "/third.webp",
      pdf: { url: "/third.pdf", page: 3 },
    };
    view.rerender(
      <DrawingCompare
        first={replacement}
        second={secondPdf}
        resolveAssetUrl={resolveAssetUrl}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("viewer")).toHaveAttribute(
        "data-pdf",
        "blob:/third.pdf",
      ),
    );
    expect(screen.getByTestId("viewer")).toHaveAttribute(
      "data-secondary",
      "blob:/second.webp",
    );
    expect(screen.getByTestId("viewer")).toHaveAttribute(
      "data-secondary-pdf",
      "blob:/second.pdf",
    );
    await act(async () => {
      release();
      await delay;
    });
    expect(screen.getByTestId("viewer")).toHaveAttribute(
      "data-src",
      "blob:/third.webp",
    );
  });
  it("keeps the live viewer for overlay modes and provides separate viewers side by side", () => {
    render(<DrawingCompare first={first} second={second} />);
    expect(screen.getByTestId("viewer")).toHaveAttribute(
      "data-mode",
      "overlay",
    );
    fireEvent.change(screen.getByLabelText("Comparison mode"), {
      target: { value: "difference" },
    });
    expect(screen.getByTestId("viewer")).toHaveAttribute(
      "data-mode",
      "difference",
    );
    fireEvent.change(screen.getByLabelText("Comparison mode"), {
      target: { value: "side-by-side" },
    });
    expect(screen.getAllByTestId("viewer")).toHaveLength(2);
  });
  it("exposes manual registration and resets it without altering source drawings", () => {
    render(<DrawingCompare first={first} second={second} />);
    fireEvent.change(screen.getByLabelText("Horizontal alignment"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Comparison scale"), {
      target: { value: "110" },
    });
    expect(screen.getByTestId("viewer")).toHaveAttribute(
      "data-alignment",
      JSON.stringify({ x: 0.05, y: 0, scale: 1.1 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset alignment" }));
    expect(screen.getByTestId("viewer")).toHaveAttribute(
      "data-alignment",
      JSON.stringify({ x: 0, y: 0, scale: 1 }),
    );
  });
  it("maps a secondary source point identically through PDF viewport and parent CSS transforms", () => {
    const fit = { width: 400, height: 240 },
      view = { scale: 5, x: 60, y: -30 },
      frame = { width: 800, height: 600 };
    const alignment = { x: 0.1, y: -0.05, scale: 1.2 };
    const result = comparisonGeometry(fit, view, 0.8, alignment);
    const point = { x: 0.23, y: 0.72 };
    const cssX =
      frame.width / 2 +
      view.x +
      (point.x - 0.5) * fit.width * view.scale * alignment.scale +
      alignment.x * fit.width * view.scale;
    const cssY =
      frame.height / 2 +
      view.y +
      (point.y - 0.5) * result.fit.height * view.scale * alignment.scale +
      alignment.y * fit.height * view.scale;
    const rasterX =
      frame.width / 2 +
      result.view.x +
      (point.x - 0.5) * result.fit.width * result.view.scale;
    const rasterY =
      frame.height / 2 +
      result.view.y +
      (point.y - 0.5) * result.fit.height * result.view.scale;
    expect(cssX).toBeCloseTo(rasterX);
    expect(cssY).toBeCloseTo(rasterY);
    expect(result.top).toBe(-40);
  });
});
