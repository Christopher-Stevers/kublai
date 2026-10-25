import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJobRoomCount } from "./use-job-room-count";

const mock = vi.hoisted(() => ({
  online: true,
  fetching: false,
  data: undefined as
    | { count: number }
    | undefined,
  query: vi.fn(),
}));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => mock.online,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    rooms: {
      getJobRoomCount: {
        useQuery: (input: unknown, options: unknown) => {
          mock.query(input, options);
          return { data: mock.data, isFetching: mock.fetching };
        },
      },
    },
  },
}));
beforeEach(() => {
  mock.online = true;
  mock.fetching = false;
  mock.data = undefined;
  mock.query.mockClear();
});
afterEach(cleanup);

describe("job room count", () => {
  it("reads only the compact count instead of downloading room geometry", () => {
    mock.data = { count: 2364 };
    expect(renderHook(() => useJobRoomCount("job-one")).result.current).toEqual({ count: 2364, loading: false });
  });
  it("reports an actual empty job as zero", () => {
    mock.data = { count: 0 };
    expect(
      renderHook(() => useJobRoomCount("job-one")).result.current.count,
    ).toBe(0);
  });
  it("does not report zero while loading or after a failed uncached request", () => {
    mock.fetching = true;
    const view = renderHook(() => useJobRoomCount("job-one"));
    expect(view.result.current).toEqual({ count: undefined, loading: true });
    mock.fetching = false;
    view.rerender();
    expect(view.result.current).toEqual({ count: undefined, loading: false });
  });
  it("uses the cached count offline without sending a request", () => {
    mock.online = false;
    mock.data = { count: 1 };
    expect(
      renderHook(() => useJobRoomCount("job-one")).result.current.count,
    ).toBe(1);
    expect(mock.query).toHaveBeenCalledWith(
      { jobId: "job-one" },
      expect.objectContaining({ enabled: false }),
    );
  });
  it("disables requests without a selected job or outside the options view", () => {
    const empty = renderHook(() => useJobRoomCount(null));
    expect(empty.result.current.count).toBeUndefined();
    expect(mock.query).toHaveBeenLastCalledWith(
      { jobId: "" },
      expect.objectContaining({ enabled: false }),
    );
    renderHook(() => useJobRoomCount("job-one", false));
    expect(mock.query).toHaveBeenLastCalledWith(
      { jobId: "job-one" },
      expect.objectContaining({ enabled: false }),
    );
  });
  it("refreshes the count on return to the job and window focus", () => {
    renderHook(() => useJobRoomCount("job-one"));
    expect(mock.query).toHaveBeenCalledWith(
      { jobId: "job-one" },
      expect.objectContaining({
        enabled: true,
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
      }),
    );
  });
});
