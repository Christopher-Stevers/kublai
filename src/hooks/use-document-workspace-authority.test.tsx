import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { DrawingWorkspace } from "~/lib/drawing-workspace";
import { useDocumentWorkspaceAuthority } from "./use-document-workspace-authority";
const state = vi.hoisted(() => ({ authority: {} as object }));
vi.mock("~/lib/device-query-cache", () => ({
  captureDeviceReadAuthority: () => state.authority,
}));
const key = ["document-workspace", "sheet"];
const cached = {
  sheetId: "sheet",
  actor: { id: "actor", name: "Actor" },
  canAnnotate: true,
} as DrawingWorkspace;
const clients: QueryClient[] = [];
function Reader({ account = "org:actor" }: { account?: string }) {
  const query = useQuery<DrawingWorkspace>({ queryKey: key, enabled: false });
  const certificate = useDocumentWorkspaceAuthority(
    key,
    true,
    account,
    "actor",
    "sheet",
    query,
  );
  return (
    <p>
      {certificate.confirmed && certificate.isCurrent()
        ? "Fresh authority"
        : "Read only"}
    </p>
  );
}
function setup() {
  const client = new QueryClient();
  clients.push(client);
  client.setQueryData(key, cached);
  const tree = (hidden = false, account = "org:actor") => (
    <QueryClientProvider client={client}>
      <Activity mode={hidden ? "hidden" : "visible"}>
        <Reader account={account} />
      </Activity>
    </QueryClientProvider>
  );
  return { client, tree };
}
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  state.authority = {};
});
it("manual writes/hydration cannot unlock; only a real successful current response can", async () => {
  const { client, tree } = setup();
  render(tree());
  expect(screen.getByText("Read only")).toBeTruthy();
  act(() => {
    client.setQueryData(key, { ...cached });
  });
  expect(screen.getByText("Read only")).toBeTruthy();
  await act(async () => {
    await client.fetchQuery({
      queryKey: key,
      staleTime: 0,
      queryFn: async () => cached,
    });
  });
  expect(screen.getByText("Fresh authority")).toBeTruthy();
  act(() => {
    client.setQueryData(key, client.getQueryData(key));
  });
  expect(screen.getByText("Read only")).toBeTruthy();
});
it("Activity hide destroys the certificate and resume needs another actual response", async () => {
  const { client, tree } = setup(),
    view = render(tree());
  await act(async () => {
    await client.fetchQuery({
      queryKey: key,
      staleTime: 0,
      queryFn: async () => cached,
    });
  });
  expect(screen.getByText("Fresh authority")).toBeTruthy();
  view.rerender(tree(true));
  view.rerender(tree());
  expect(screen.getByText("Read only")).toBeTruthy();
  await act(async () => {
    await client.fetchQuery({
      queryKey: key,
      staleTime: 0,
      queryFn: async () => cached,
    });
  });
  expect(screen.getByText("Fresh authority")).toBeTruthy();
});
it("rejects wrong actor/sheet and fences account/read-generation changes", async () => {
  const { client, tree } = setup(),
    view = render(tree());
  for (const value of [
    { ...cached, actor: { id: "other", name: "Other" } },
    { ...cached, sheetId: "other" },
  ]) {
    await act(async () => {
      await client.fetchQuery({
        queryKey: key,
        staleTime: 0,
        queryFn: async () => value,
      });
    });
    expect(screen.getByText("Read only")).toBeTruthy();
  }
  await act(async () => {
    await client.fetchQuery({
      queryKey: key,
      staleTime: 0,
      queryFn: async () => cached,
    });
  });
  state.authority = {};
  view.rerender(tree(false, "org:actor:new-simulation"));
  expect(screen.getByText("Read only")).toBeTruthy();
});
