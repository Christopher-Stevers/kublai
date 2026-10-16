import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LandingPageProvider, useLandingPagePicker } from "./LandingPageProvider";
import { SnapshotSourceContext } from "~/components/chat/SnapshotSourceContext";
import { useLandingPage } from "~/hooks/use-landing-page";
import { makeSnapshotSource } from "~/lib/snapshot-source";
const target = makeSnapshotSource("/dashboard/jobs/0391aed4-7773-47ec-9141-09df373ec008/drawings", { version: 1, pages: { "drawings:selection": "sheet-3" } }, "Alma drawing");
const captureSource = vi.fn(() => target);
function Controls() {
  const picker = useLandingPagePicker();
  const saved = useLandingPage("crew");
  return <><button onClick={() => picker?.start()}>Choose destination</button><output>{saved.source?.title ?? "Jobs"}</output></>;
}
beforeEach(() => {
  for (const name of ["localStorage", "sessionStorage"]) {
    const values = new Map<string, string>();
    vi.stubGlobal(name, { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  }
  captureSource.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = () => render(<SnapshotSourceContext.Provider value={{ captureSource, register: () => () => undefined, registerPage: () => () => undefined }}><LandingPageProvider userId="crew"><Controls /></LandingPageProvider></SnapshotSourceContext.Provider>);
it("lets the user browse before capturing the current page with the checkmark", async () => {
  mount();
  fireEvent.click(screen.getByText("Choose destination"));
  expect(captureSource).not.toHaveBeenCalled();
  expect(screen.getByText("Navigate to your landing page, then tap the checkmark.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save current page as landing page" }));
  expect(captureSource).toHaveBeenCalledOnce();
  expect(screen.getByText("Alma drawing")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Save current page as landing page" })).toBeNull();
});
it("restores picking after a page load and cancels without changing the destination", async () => {
  sessionStorage.setItem("foremenhq:landing-picker:crew", "true");
  await act(async () => mount());
  fireEvent.click(screen.getByRole("button", { name: "Cancel landing page selection" }));
  expect(captureSource).not.toHaveBeenCalled();
  expect(screen.getByText("Jobs")).toBeVisible();
  expect(sessionStorage.getItem("foremenhq:landing-picker:crew")).toBeNull();
});
