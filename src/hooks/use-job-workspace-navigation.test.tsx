import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getLastJobWorkspaceLocation, setLastJobWorkspaceLocation, type JobWorkspaceLocation } from "~/lib/job-workspace-last-option";
import { resetJobWorkspaceNavigation, useJobWorkspaceNavigation } from "./use-job-workspace-navigation";
import { makeSnapshotSource } from "~/lib/snapshot-source";
import { runHeaderBackOverride } from "~/lib/header-back-events";

const job: JobWorkspaceLocation = { jobId: "job-1", view: "options", materialListId: null };
const lists: JobWorkspaceLocation = { ...job, view: "material-lists" };
const list: JobWorkspaceLocation = { ...lists, materialListId: "list-1" };
const nextState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: [] } };
const tick = () => act(() => new Promise(resolve => setTimeout(resolve, 10)));
beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  window.history.pushState(nextState, "", "/dashboard");
});
afterEach(async () => { cleanup(); await tick(); vi.unstubAllGlobals(); });

it("goes to parents rather than visited sibling screens", async () => {
  const { result } = renderHook(useJobWorkspaceNavigation);
  for (const location of [job, { ...job, view: "chat" as const }, lists, list]) {
    act(() => result.current.navigate(location));
  }
  expect(window.history.state).toMatchObject(nextState);
  for (const parent of [lists, job, null]) {
    act(() => result.current.back());
    expect(result.current.location).toEqual(parent);
    expect(getLastJobWorkspaceLocation()).toEqual(parent);
  }
});
it("takes the Android/browser gesture up the same hierarchy", async () => {
  const { result } = renderHook(useJobWorkspaceNavigation);
  act(() => result.current.navigate(list)); // No parents visited.
  await tick();
  for (const parent of [lists, job, null]) {
    act(() => window.history.back());
    await waitFor(() => expect(result.current.location).toEqual(parent));
    await tick();
  }
});
it("reopens a captured list and goes up even when opened from a link", () => {
  const captured = { ...list, jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", materialListId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
  setLastJobWorkspaceLocation(job);
  const source = makeSnapshotSource("/dashboard", { version: 1, workspace: captured }, "Captured list");
  window.history.replaceState(nextState, "", source.href);
  const { result } = renderHook(useJobWorkspaceNavigation, { wrapper: StrictMode });
  expect(result.current.location).toEqual(captured);
  act(() => result.current.back());
  expect(result.current.location).toEqual({ ...captured, materialListId: null });
});
it("normalizes a saved list and retains its location across remounts", () => {
  setLastJobWorkspaceLocation({ ...list, view: "options" });
  const first = renderHook(useJobWorkspaceNavigation, { wrapper: StrictMode });
  expect(first.result.current.location).toEqual(list);
  first.unmount();
  const { result } = renderHook(useJobWorkspaceNavigation);
  expect(result.current.location).toEqual(list);
  act(() => result.current.back());
  expect(result.current.location).toEqual(lists);
});
it.each(["rooms", "chat", "documents", "drawings", "models"] as const)("goes from %s directly to the job", view => {
  setLastJobWorkspaceLocation({ ...job, view });
  const { result } = renderHook(useJobWorkspaceNavigation);
  act(() => { runHeaderBackOverride(); });
  expect(result.current.location).toEqual(job);
});
it("the logo reset immediately clears an already mounted workspace", () => {
  const { result } = renderHook(useJobWorkspaceNavigation);
  act(() => result.current.navigate(list));
  act(() => resetJobWorkspaceNavigation());
  expect(result.current.location).toBeNull();
  expect(getLastJobWorkspaceLocation()).toBeNull();
  expect(window.history.state).toMatchObject(nextState);
});
