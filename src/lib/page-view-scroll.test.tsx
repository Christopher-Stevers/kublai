import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { capturePageScrolls, restorePageScrolls } from "./page-view-scroll";
import { makeSnapshotSource, readSnapshotState } from "./snapshot-source";
afterEach(cleanup);
it("reopens nested scrolling areas after a fresh render and excludes picker UI", () => {
  const page = (
    <main>
      <section>
        <div data-testid="scroller">Messages</div>
      </section>
      <div data-snapshot-ui>
        <div data-testid="picker">Picker</div>
      </div>
    </main>
  );
  const first = render(page);
  first.getByTestId("scroller").scrollTop = 450;
  first.getByTestId("scroller").scrollLeft = 25;
  first.getByTestId("picker").scrollTop = 100;
  const source = makeSnapshotSource(
    "/dashboard/chat?conversation=abc",
    { version: 1, scrolls: capturePageScrolls() },
    "Chat",
  );
  const saved = readSnapshotState(
    new URL(source.href, "https://app.invalid").hash,
  )!;
  expect(saved.scrolls).toHaveLength(1);
  first.unmount();
  cleanup();
  expect(restorePageScrolls(saved.scrolls!)).toBe(false);
  const second = render(page);
  expect(restorePageScrolls(saved.scrolls!)).toBe(true);
  expect(second.getByTestId("scroller").scrollTop).toBe(450);
  expect(second.getByTestId("scroller").scrollLeft).toBe(25);
});
