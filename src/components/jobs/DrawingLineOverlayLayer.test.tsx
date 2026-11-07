import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("~/lib/pdf-client", () => ({ loadPdfDocument: vi.fn() }));
vi.mock("./DrawingPdfLayer", () => ({ DrawingPdfLayer: () => null }));
import { DrawingComparisonLayer } from "./DrawingComparisonLayer";

// Exercise the actual theme override that caused white paper to turn dark.
const stylesheet = readFileSync("src/styles/globals.css", "utf8");
const darkRule =
  /\.dark \.bg-white,[\s\S]*?\{\s*background-color: var\(--card\);\s*\}/.exec(
    stylesheet,
  )?.[0];
// jsdom does not resolve CSS custom properties; use the dark card's resolved colour.
const themeCss = `.bg-white { background-color: #fff; } ${darkRule?.replace("var(--card)", "#111111")}`;
const styles: HTMLStyleElement[] = [];
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  for (const style of styles.splice(0)) style.remove();
});
describe("drawing comparison paper in the app themes", () => {
  it.each(["light", "dark"])(
    "keeps overview, zoom detail and paper white in %s mode",
    (theme) => {
      expect(darkRule).toBeTruthy();
      const style = document.createElement("style");
      style.textContent = themeCss;
      document.head.append(style);
      styles.push(style);
      if (theme === "dark") document.documentElement.classList.add("dark");
      // Control confirms the existing theme really darkens ordinary white app surfaces.
      const card = document.createElement("div");
      card.className = "bg-white";
      document.body.append(card);
      if (theme === "dark")
        expect(getComputedStyle(card).backgroundColor).toBe("rgb(17, 17, 17)");
      card.remove();
      const { container } = render(
        <DrawingComparisonLayer
          primary={{ src: "/first.png" }}
          comparison={{
            src: "/second.png",
            mode: "overlay",
            opacity: 1,
            wipe: 0.5,
            alignment: { x: 0, y: 0, scale: 1 },
          }}
          fit={{ width: 1000, height: 600 }}
          frameSize={{ width: 400, height: 600 }}
          view={{ scale: 1, x: 0, y: 0 }}
          dpr={2}
        />,
      );
      const paper = container.querySelector('[data-line-overlay="true"]')!;
      expect(getComputedStyle(paper).backgroundColor).toBe(
        "rgb(255, 255, 255)",
      );
      const canvases = [...paper.querySelectorAll("canvas")];
      expect(canvases).toHaveLength(2);
      for (const canvas of canvases)
        expect(getComputedStyle(canvas).backgroundColor).toBe(
          "rgb(255, 255, 255)",
        );
    },
  );
  it("keeps the red/blue comparison on white paper in dark mode", () => {
    document.documentElement.classList.add("dark");
    const style = document.createElement("style");
    style.textContent = themeCss;
    document.head.append(style);
    styles.push(style);
    const { container } = render(
      <DrawingComparisonLayer
        primary={{ src: "/first.png" }}
        comparison={{
          src: "/second.png",
          mode: "difference",
          opacity: 1,
          wipe: 0.5,
          alignment: { x: 0, y: 0, scale: 1 },
        }}
        fit={{ width: 1000, height: 600 }}
        frameSize={{ width: 400, height: 600 }}
        view={{ scale: 1, x: 0, y: 0 }}
        dpr={2}
      />,
    );
    const primary = container.querySelector('[data-line-overlay="true"]')!;
    expect(container.querySelector("feColorMatrix")).toBeNull();
    expect(container.querySelector('[style*="multiply"]')).toBeNull();
    expect(getComputedStyle(primary).backgroundColor).toBe(
      "rgb(255, 255, 255)",
    );
  });
});
