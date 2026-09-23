import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  getLastJobWorkspaceLocation,
  setLastJobWorkspaceLocation,
  type JobWorkspaceLocation,
} from "~/lib/job-workspace-last-option";
import { useJobWorkspaceNavigation } from "./use-job-workspace-navigation";

const job: JobWorkspaceLocation = {
  jobId: "job-1",
  view: "options",
  materialListId: null,
};
const lists: JobWorkspaceLocation = { ...job, view: "material-lists" };
const list: JobWorkspaceLocation = { ...lists, materialListId: "list-1" };
const nextState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: [] } };

beforeEach(() => {
  // Node 26 exposes an unavailable native localStorage in the test environment.
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  // Start at the end of the stack, discarding forward entries from prior tests.
  window.history.pushState(nextState, "", "/dashboard");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("uses the same stack for the arrow, browser back and forward without duplicate screens", async () => {
  const { result } = renderHook(useJobWorkspaceNavigation);
  const startLength = window.history.length;
  for (const location of [job, lists, list, list]) {
    act(() => result.current.navigate(location));
  }
  expect(window.history.length).toBe(startLength + 3);
  expect(window.history.state).toMatchObject(nextState);
  expect(window.location.pathname).toBe("/dashboard");

  act(() => result.current.back());
  await waitFor(() => expect(result.current.location).toEqual(lists));
  expect(getLastJobWorkspaceLocation()).toEqual(lists);
  act(() => window.history.back());
  await waitFor(() => expect(result.current.location).toEqual(job));
  act(() => window.history.back());
  await waitFor(() => expect(result.current.location).toBeNull());
  expect(getLastJobWorkspaceLocation()).toBeNull();
  act(() => window.history.forward());
  await waitFor(() => expect(result.current.location).toEqual(job));

  act(() => result.current.navigate({ ...job, view: "rooms" }));
  act(() => window.history.back());
  await waitFor(() => expect(result.current.location).toEqual(job));
});

it("reopens a saved list with all its parents, including under Strict Mode", async () => {
  // Older versions could store an options view alongside a selected list.
  setLastJobWorkspaceLocation({ ...list, view: "options" });
  const startLength = window.history.length;
  const { result } = renderHook(useJobWorkspaceNavigation, {
    wrapper: StrictMode,
  });
  expect(result.current.location).toEqual(list);
  expect(window.history.length).toBe(startLength + 3);
  for (const parent of [lists, job, null]) {
    act(() => window.history.back());
    await waitFor(() => expect(result.current.location).toEqual(parent));
  }
});

it("does not add duplicate parents after a reload or remount", async () => {
  setLastJobWorkspaceLocation(list);
  const first = renderHook(useJobWorkspaceNavigation);
  const length = window.history.length;
  first.unmount();
  const { result } = renderHook(useJobWorkspaceNavigation);
  expect(window.history.length).toBe(length);
  expect(result.current.location).toEqual(list);
  act(() => result.current.back());
  await waitFor(() => expect(result.current.location).toEqual(lists));
});

it("restores the visited dashboard entry instead of reopening the latest saved list", () => {
  const first = renderHook(useJobWorkspaceNavigation);
  first.unmount();
  setLastJobWorkspaceLocation(list);
  const length = window.history.length;
  const { result } = renderHook(useJobWorkspaceNavigation);
  expect(result.current.location).toBeNull();
  expect(getLastJobWorkspaceLocation()).toBeNull();
  expect(window.history.length).toBe(length);
});

it("restores rooms with a job and dashboard to return to", async () => {
  setLastJobWorkspaceLocation({ ...job, view: "rooms" });
  const { result } = renderHook(useJobWorkspaceNavigation);
  expect(result.current.location?.view).toBe("rooms");
  act(() => window.history.back());
  await waitFor(() => expect(result.current.location).toEqual(job));
  act(() => window.history.back());
  await waitFor(() => expect(result.current.location).toBeNull());
});

it("leaves ordinary route navigation to the router", () => {
  const { result, unmount } = renderHook(useJobWorkspaceNavigation);
  act(() => result.current.navigate(job));
  act(() => {
    // Even a carried-over workspace marker must not take over another route.
    window.history.pushState(window.history.state, "", "/dashboard/catalogue");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(result.current.location).toEqual(job);
  expect(getLastJobWorkspaceLocation()).toEqual(job);
  unmount();
  setLastJobWorkspaceLocation(list);
  window.history.replaceState(nextState, "", "/dashboard");
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(getLastJobWorkspaceLocation()).toEqual(list);
});
