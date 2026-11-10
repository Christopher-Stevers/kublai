import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PageWindowSettings } from "./PageWindowSettings";
import { getPageWindowMode, pageDevice } from "~/lib/page-window-mode";
beforeEach(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("defaults mobile to internal and desktop to external and remembers independent choices", () => {
  const view = render(<PageWindowSettings />);
  expect(screen.getByLabelText("Mobile")).toHaveValue("internal");
  expect(screen.getByLabelText("Desktop")).toHaveValue("external");
  fireEvent.change(screen.getByLabelText("Desktop"), { target: { value: "internal" } });
  fireEvent.change(screen.getByLabelText("Mobile"), { target: { value: "external" } });
  view.unmount();
  render(<PageWindowSettings />);
  expect(screen.getByLabelText("Mobile")).toHaveValue("external");
  expect(screen.getByLabelText("Desktop")).toHaveValue("internal");
  expect(getPageWindowMode("desktop")).toBe("internal");
});
it("recognizes mobile devices even when their viewport is wide", () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone)");
  expect(pageDevice()).toBe("mobile");
});
