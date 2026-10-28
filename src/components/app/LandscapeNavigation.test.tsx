import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  deviceIsLandscape,
  findLandscapeNavigationSlot,
  LandscapeNavigation,
  useLandscapeLayout,
} from "./LandscapeNavigation";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-app-landscape");
});
function media(landscape: boolean, touch = false) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("pointer") ? touch : landscape,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}
it("uses window orientation on desktop", () => {
  media(true);
  expect(deviceIsLandscape()).toBe(true);
  media(false);
  expect(deviceIsLandscape()).toBe(false);
});
it("does not mistake a portrait phone keyboard for rotation", () => {
  media(true, true);
  vi.stubGlobal("screen", { orientation: { type: "portrait-primary" } });
  expect(deviceIsLandscape()).toBe(false);
});
it("honours iPad's physical orientation", () => {
  media(false, true);
  vi.stubGlobal("orientation", 90);
  expect(deviceIsLandscape()).toBe(true);
});
it("restores portrait chrome when rotated back", async () => {
  media(true);
  function Layout() {
    const active = useLandscapeLayout();
    return <output>{active ? "landscape" : "portrait"}</output>;
  }
  render(<Layout />);
  expect(document.documentElement).toHaveAttribute("data-app-landscape");
  media(false);
  await act(() => { window.dispatchEvent(new Event("resize")); });
  expect(screen.getByText("portrait")).toBeInTheDocument();
  expect(document.documentElement).not.toHaveAttribute("data-app-landscape");
});
it("selects the last visible active bar and excludes hidden/inert footers", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 800,
    height: 44,
    top: 500,
    bottom: 544,
  } as DOMRect);
  render(
    <>
      <div>
        <div data-landscape-navigation-slot id="first" />
      </div>
      <div>
        <div data-landscape-navigation-slot id="active" />
      </div>
      <div inert>
        <div data-landscape-navigation-slot />
      </div>
      <div hidden>
        <div data-landscape-navigation-slot />
      </div>
    </>,
  );
  expect(findLandscapeNavigationSlot()?.id).toBe("active");
});
it("reuses passed actions in the bar and provides a fallback when no bar exists", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 800,
    height: 44,
    top: 500,
    bottom: 544,
  } as DOMRect);
  const back = vi.fn(),
    home = vi.fn();
  const actions = (
    <>
      <button onClick={back}>Back</button>
      <button onClick={home}>Logo</button>
    </>
  );
  const { rerender } = render(
    <LandscapeNavigation active>{actions}</LandscapeNavigation>,
  );
  expect(
    document.querySelector("[data-landscape-fallback-bar]"),
  ).not.toBeNull();
  fireEvent.click(screen.getByText("Back"));
  fireEvent.click(screen.getByText("Logo"));
  expect(back).toHaveBeenCalledOnce();
  expect(home).toHaveBeenCalledOnce();
  rerender(
    <>
      <div>
        <div data-landscape-navigation-slot id="dock" />
      </div>
      <LandscapeNavigation active={false}>{actions}</LandscapeNavigation>
    </>,
  );
  rerender(
    <>
      <div>
        <div data-landscape-navigation-slot id="dock" />
      </div>
      <LandscapeNavigation active>{actions}</LandscapeNavigation>
    </>,
  );
  expect(screen.getByText("Logo").closest("#dock")).not.toBeNull();
  expect(document.querySelector("[data-landscape-fallback-bar]")).toBeNull();
});
