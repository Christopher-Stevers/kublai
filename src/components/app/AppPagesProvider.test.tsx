import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  usePathname: () => "/jobs",
  useSearchParams: () => "",
}));
import { AppPagesProvider, appPageHref, useAppPages } from "./AppPagesProvider";
function Content() {
  const pages = useAppPages()!;
  return (
    <main>
      <h1>Material list</h1>
      <input aria-label="Unfinished note" />
      <button onClick={() => pages.open("/jobs/order")}>New page</button>
      <button onClick={pages.show}>Pages {pages.count}</button>
    </main>
  );
}
beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("rejects external and non-app destinations", () => {
  expect(
    appPageHref("https://evil.example/jobs", "https://app.example"),
  ).toBeNull();
  expect(appPageHref("javascript:alert(1)", "https://app.example")).toBeNull();
  expect(appPageHref("/api/admin", "https://app.example")).toBeNull();
  expect(appPageHref("/jobs/a?sheet=2#view", "https://app.example")).toBe(
    "/jobs/a?sheet=2#view",
  );
});
it("keeps drafts and frame identity while switching, then removes explicitly closed pages", async () => {
  const { container } = render(
    <AppPagesProvider>
      <Content />
    </AppPagesProvider>,
  );
  fireEvent.change(screen.getByLabelText("Unfinished note"), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(screen.getByText("New page"));
  const frame = container.querySelector("iframe")!;
  expect(frame.getAttribute("src")).toBe("/jobs/order");
  expect(screen.getByLabelText("Unfinished note")).not.toBeVisible();
  // Only a known frame may open the host switcher.
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: window.location.origin,
      source: frame.contentWindow,
      data: { channel: "foremanhq-open-pages-v1", type: "show" },
    }),
  );
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: /^Material list/ }));
  expect(screen.getByLabelText("Unfinished note")).toHaveValue(
    "Keep this draft",
  );
  expect(screen.getByLabelText("Unfinished note")).toBeVisible();
  expect(container.querySelector("iframe")).toBe(frame);
  fireEvent.click(screen.getByText("Pages 2"));
  fireEvent.click(screen.getByRole("button", { name: "Close Loading page…" }));
  await waitFor(() => expect(container.querySelector("iframe")).toBeNull());
});
it("ignores messages from unknown windows", () => {
  render(
    <AppPagesProvider>
      <Content />
    </AppPagesProvider>,
  );
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: window.location.origin,
      source: window,
      data: {
        channel: "foremanhq-open-pages-v1",
        type: "open",
        href: "/jobs/a",
      },
    }),
  );
  expect(screen.getByText("Pages 1")).toBeVisible();
});
