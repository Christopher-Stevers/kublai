import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { runHeaderBackOverride } from "~/lib/header-back-events";
import { ScanSlipButton } from "./ScanSlipButton";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: vi.fn() }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function Scanner({
      onSave,
      extraActions,
      pageAction,
    }: {
      onSave: (file: File) => Promise<boolean>;
      extraActions?: ReactNode;
      pageAction?: (leave: () => boolean) => ReactNode;
    }) {
      return (
        <>
        {extraActions}
        {pageAction?.(() => true)}
        <button
          onClick={() =>
            void onSave(
              new File(["scan"], "Packing slip.pdf", {
                type: "application/pdf",
              }),
            )
          }
        >
          Done
        </button>
        </>
      );
    },
}));
afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

it("saves a scan and opens its durable review without waiting for detection", async () => {
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/queue")) return Response.json({ documents: [] });
    expect(options?.body).toBeInstanceOf(FormData);
    return Response.json({
      documentId: "doc",
      queued: true,
      orders: [],
      candidates: [],
      match: null,
    });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ScanSlipButton jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Receive" }));
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("/jobs/job/receiving?document=doc"),
  );
  expect(
    fetcher.mock.calls.filter(([url]) => !url.includes("/queue")),
  ).toHaveLength(1);
});
it("opens a saved slip in the same shared review", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        slips: [
          {
            id: "saved",
            name: "Saved slip.pdf",
            createdAt: "2026-10-26",
            packingSlip: {
              orderId: "order",
              orderNumber: "PO-155",
              materialListId: "list",
              materialListName: "List",
            },
            status: "applied",
          },
        ],
      }),
    ),
  );
  render(<ScanSlipButton jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Receive" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Saved slips" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Saved slip.pdf/ }),
  );
  expect(push).toHaveBeenCalledWith("/jobs/job/receiving?document=saved");
});
it("keeps a failed upload visible and never navigates as though it succeeded", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: "Upload interrupted" }, { status: 503 }),
    ),
  );
  render(<ScanSlipButton jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Receive" }));
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  await screen.findByText("Upload interrupted");
  expect(push).not.toHaveBeenCalled();
});
it("opens as a full page with its buttons in the bottom bar", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ slips: [] })));
  render(<ScanSlipButton jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Receive" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Saved slips" }),
  );
  const page = await screen.findByRole("dialog", { name: "Saved packing slips" });
  // Under the app header, which stays in use.
  expect(page.parentElement!.className).toContain("app-below-header");
  expect(page.className).toContain("h-full");
  const bar = page.querySelector("[data-action-bar]")!;
  expect(
    Array.from(bar.querySelectorAll("button"), (button) => button.textContent),
  ).toEqual(["Queue", "Scan a new slip"]);
});
it("shows how many slips wait in the queue and opens it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/queue")
        ? Response.json({
            documents: [
              { status: "review" },
              { status: "processing" },
              { status: "complete" },
            ],
          })
        : Response.json({ slips: [] }),
    ),
  );
  render(<ScanSlipButton jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Receive" }));
  const queue = await screen.findByRole("button", {
    name: /^Queue\W+2 waiting$/,
  });
  fireEvent.click(queue);
  expect(push).toHaveBeenCalledWith("/jobs/job/receiving");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("leaves the page with the app header's back button", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ slips: [] })));
  render(<ScanSlipButton jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Receive" }));
  fireEvent.click(await screen.findByRole("button", { name: "Saved slips" }));
  await screen.findByRole("dialog", { name: "Saved packing slips" });
  await waitFor(() => expect(runHeaderBackOverride()).toBe(true));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(push).not.toHaveBeenCalled();
});
