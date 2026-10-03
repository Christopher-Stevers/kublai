import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  HEADER_BACK_REQUEST_EVENT,
  HEADER_BACK_STATE_EVENT,
} from "~/lib/header-back-events";
import { getLastJobWorkspaceLocation } from "~/lib/job-workspace-last-option";
import { useJobChatParentNavigation } from "./use-job-chat-parent-navigation";
const { push, router } = vi.hoisted(() => {
  const push = vi.fn();
  return { push, router: { push } };
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  push.mockReset();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("opens the parent job from the header even when Chat had no previous page", async () => {
  const visibility = vi.fn();
  window.addEventListener(HEADER_BACK_STATE_EVENT, visibility);
  const length = window.history.length;
  const view = renderHook(() => useJobChatParentNavigation("job-one"));
  expect(window.history.length).toBe(length);
  await act(() => window.dispatchEvent(new Event(HEADER_BACK_REQUEST_EVENT)));
  expect(push).toHaveBeenCalledWith("/dashboard/jobs/job-one");
  expect(getLastJobWorkspaceLocation()).toEqual({
    jobId: "job-one",
    view: "options",
    materialListId: null,
  });
  view.unmount();
  expect((visibility.mock.lastCall![0] as CustomEvent).detail).toEqual({
    visible: false,
  });
  push.mockClear();
  window.dispatchEvent(new Event(HEADER_BACK_REQUEST_EVENT));
  expect(push).not.toHaveBeenCalled();
  window.removeEventListener(HEADER_BACK_STATE_EVENT, visibility);
});
it("does not replace normal browser back and forward", async () => {
  renderHook(() => useJobChatParentNavigation("job-one"));
  await act(() => window.dispatchEvent(new PopStateEvent("popstate")));
  expect(push).not.toHaveBeenCalled();
});
it("updates the parent destination when a notification selects another job", async () => {
  const view = renderHook(({ jobId }) => useJobChatParentNavigation(jobId), {
    initialProps: { jobId: "job-one" },
  });
  view.rerender({ jobId: "job-two" });
  await act(() => window.dispatchEvent(new Event(HEADER_BACK_REQUEST_EVENT)));
  expect(push).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenCalledWith("/dashboard/jobs/job-two");
});
