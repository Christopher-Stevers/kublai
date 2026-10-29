import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDrawingQuickWheelMode } from "./useDrawingQuickWheelMode";
vi.mock("./DrawingAccountProvider", () => ({ useDrawingAccount: () => ({ accountKey: "compact-test" }) }));
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), clear: () => values.clear() });
});
function viewport(width: number, height: number, landscape: boolean, touch = true) {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", height);
  vi.stubGlobal("orientation", landscape ? 90 : 0);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(pointer: coarse)" ? touch : landscape, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.dispatchEvent(new Event("resize"));
}
function Probe() {
  const { enabled, setEnabled } = useDrawingQuickWheelMode();
  return <><input type="checkbox" role="switch" aria-label="Quickwheel mode" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><output>{enabled ? "wheel" : "bars"}</output></>;
}
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
it("switches on for a rotated phone and restores the normal portrait preference", () => {
  viewport(390, 844, false); render(<Probe />);
  expect(screen.getByText("bars")).toBeInTheDocument();
  act(() => viewport(844, 390, true));
  expect(screen.getByText("wheel")).toBeInTheDocument();
  expect(localStorage.getItem("foremanhq:drawing-quick-wheel:compact-test")).toBeNull();
  act(() => viewport(390, 844, false));
  expect(screen.getByText("bars")).toBeInTheDocument();
});
it("keeps tablet, unfolded-phone, desktop, and portrait-keyboard layouts in normal mode", () => {
  viewport(1024, 768, true); render(<Probe />);
  expect(screen.getByText("bars")).toBeInTheDocument();
  act(() => viewport(850, 680, true));
  expect(screen.getByText("bars")).toBeInTheDocument();
  act(() => viewport(900, 450, true, false));
  expect(screen.getByText("bars")).toBeInTheDocument();
  act(() => viewport(390, 300, false));
  expect(screen.getByText("bars")).toBeInTheDocument();
});
it("allows a compact-screen override and resets the automatic choice on the next rotation", () => {
  viewport(390, 844, false); render(<Probe />);
  act(() => viewport(844, 390, true));
  fireEvent.click(screen.getByRole("switch", {name: "Quickwheel mode"}));
  expect(screen.getByText("bars")).toBeInTheDocument();
  act(() => viewport(840, 390, true));
  expect(screen.getByText("bars")).toBeInTheDocument();
  act(() => viewport(390, 844, false));
  act(() => viewport(844, 390, true));
  expect(screen.getByText("wheel")).toBeInTheDocument();
});
