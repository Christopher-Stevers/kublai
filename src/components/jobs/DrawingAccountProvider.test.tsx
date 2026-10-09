import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDrawingOfflineAccount } from "~/lib/drawing-offline";
import { clearPdfDocuments } from "~/lib/pdf-client";
import { clearDrawingTextIndexes } from "~/lib/drawing-text";
import {
  DrawingAccountProvider,
  clearDrawingDownloadsOnSignOut,
  useDrawingAccount,
} from "./DrawingAccountProvider";

const dispose = vi.hoisted(() => vi.fn());
vi.mock("~/lib/drawing-offline", () => ({
  setDrawingOfflineAccount: vi.fn(),
  DrawingOfflineStore: class {
    dispose = dispose;
  },
}));
vi.mock("~/lib/pdf-client", () => ({ clearPdfDocuments: vi.fn() }));
vi.mock("~/lib/drawing-text", () => ({ clearDrawingTextIndexes: vi.fn() }));
beforeEach(() =>
  vi.mocked(setDrawingOfflineAccount).mockResolvedValue(undefined),
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function PrivateView() {
  const account = useDrawingAccount();
  const [draft, setDraft] = useState(0);
  return (
    <button
      data-user-id={account?.userId}
      onClick={() => setDraft((value) => value + 1)}
    >
      Private {account?.accountKey} draft {draft}
    </button>
  );
}
describe("drawing account boundary", () => {
  it("keeps the employee identity separate from each simulation's private cache", async () => {
    const client = new QueryClient();
    const view = (simulationId?: string) => (
      <QueryClientProvider client={client}>
        <DrawingAccountProvider
          userId="alice"
          organizationId="org"
          simulationId={simulationId}
        >
          <PrivateView />
        </DrawingAccountProvider>
      </QueryClientProvider>
    );
    const mounted = render(view("session-one"));
    const first = await screen.findByRole("button", {
      name: "Private org:alice:simulation:session-one draft 0",
    });
    expect(first).toHaveAttribute("data-user-id", "alice");
    fireEvent.click(first);
    mounted.rerender(view("session-two"));
    expect(
      await screen.findByRole("button", {
        name: "Private org:alice:simulation:session-two draft 0",
      }),
    ).toHaveAttribute("data-user-id", "alice");
    mounted.rerender(view());
    expect(
      await screen.findByRole("button", { name: "Private org:alice draft 0" }),
    ).toHaveAttribute("data-user-id", "alice");
    expect(
      vi.mocked(setDrawingOfflineAccount).mock.calls.map(([key]) => key),
    ).toEqual([
      "org:alice:simulation:session-one",
      "org:alice:simulation:session-two",
      "org:alice",
    ]);
  });
  it("unmounts private views, clears PDF/text/query data, and locks after another tab changes account", async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <DrawingAccountProvider userId="alice" organizationId="org">
          <PrivateView />
        </DrawingAccountProvider>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("button", { name: "Private org:alice draft 0" }),
    ).toBeVisible();
    client.setQueryData(
      [["drawingsWorkspace", "get"], { input: { sheetId: "one" } }],
      { private: "Alice" },
    );
    client.setQueryData(["unrelated"], "keep");
    await act(() =>
      window.dispatchEvent(new Event("foremanhq-drawing-account-invalidated")),
    );
    expect(screen.queryByText(/Private org:alice/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reload session" }),
    ).toBeVisible();
    expect(
      client.getQueryData([
        ["drawingsWorkspace", "get"],
        { input: { sheetId: "one" } },
      ]),
    ).toBeUndefined();
    expect(client.getQueryData(["unrelated"])).toBe("keep");
    expect(clearPdfDocuments).toHaveBeenCalled();
    expect(clearDrawingTextIndexes).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  });
  it("remounts local draft state when a server-validated account prop changes", async () => {
    const client = new QueryClient();
    const view = (userId: string) => (
      <QueryClientProvider client={client}>
        <DrawingAccountProvider userId={userId} organizationId="org">
          <PrivateView />
        </DrawingAccountProvider>
      </QueryClientProvider>
    );
    const mounted = render(view("alice"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Private org:alice draft 0" }),
    );
    expect(
      screen.getByRole("button", { name: "Private org:alice draft 1" }),
    ).toBeVisible();
    mounted.rerender(view("bob"));
    expect(screen.queryByText(/Private org:alice/)).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Private org:bob draft 0" }),
    ).toBeVisible();
  });
  it("preserves authenticated online use when offline storage is unavailable", async () => {
    vi.mocked(setDrawingOfflineAccount).mockRejectedValueOnce(
      new Error("Storage blocked"),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DrawingAccountProvider userId="alice" organizationId="org">
          <PrivateView />
        </DrawingAccountProvider>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("button", { name: "Private org:alice draft 0" }),
    ).toBeVisible();
  });
  it("locks the current UI immediately when signing out, before persistent cleanup finishes", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DrawingAccountProvider userId="alice" organizationId="org">
          <PrivateView />
        </DrawingAccountProvider>
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Private org:alice draft 0" });
    await act(async () => {
      await clearDrawingDownloadsOnSignOut();
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reload session" }),
      ).toBeVisible(),
    );
    expect(setDrawingOfflineAccount).toHaveBeenLastCalledWith(null);
  });
});
