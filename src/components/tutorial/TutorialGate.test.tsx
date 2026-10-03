import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialGate, RestartTutorialCard } from "./TutorialGate";
import {
  readTutorialProgress,
  tutorialStorageKey,
} from "~/lib/tutorial-progress";
import {
  getLastJobWorkspaceLocation,
  setLastJobWorkspaceLocation,
} from "~/lib/job-workspace-last-option";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  replace: vi.fn(),
  finish: vi.fn(),
  restart: vi.fn(),
  state: vi.fn(),
  realMounted: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => mocks.pathname,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      client: {
        user: {
          finishTutorial: { mutate: mocks.finish },
          restartTutorial: { mutate: mocks.restart },
          getTutorialState: { query: mocks.state },
        },
      },
    }),
  },
}));
vi.mock("./TutorialExperience", () => ({
  TutorialExperience: ({
    onFinish,
  }: {
    onFinish: (outcome: "completed" | "skipped") => void;
  }) => (
    <div>
      <h1>Practice Jobs</h1>
      <button onClick={() => onFinish("completed")}>Finish tutorial</button>
      <button onClick={() => onFinish("skipped")}>End tutorial</button>
    </div>
  ),
}));
function RealApp() {
  useEffect(() => {
    mocks.realMounted();
  }, []);
  return (
    <>
      <h1>Real Jobs</h1>
      <RestartTutorialCard />
    </>
  );
}
const gate = (completed = false, userId = "user-a") => (
  <TutorialGate key={userId} userId={userId} initialCompleted={completed}>
    <RealApp />
  </TutorialGate>
);
let stored: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/dashboard";
  mocks.finish.mockResolvedValue({});
  mocks.restart.mockResolvedValue({});
  mocks.state.mockRejectedValue(new Error("Offline"));
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  window.history.replaceState(
    { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: {} },
    "",
    "/dashboard",
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("tutorial isolation and lifecycle", () => {
  it("shows only practice jobs on first entry, including deep links", () => {
    mocks.pathname = "/dashboard/jobs/real-job/rooms";
    render(gate());
    expect(screen.getByText("Practice Jobs")).toBeInTheDocument();
    expect(screen.queryByText("Real Jobs")).not.toBeInTheDocument();
    expect(mocks.realMounted).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("finishes, clears saved/history job navigation, and stops showing the tour on reload", async () => {
    setLastJobWorkspaceLocation({
      jobId: "real-job",
      view: "rooms",
      materialListId: null,
    });
    window.history.replaceState(
      {
        __NA: true,
        foremenhqWorkspace: {
          version: 1,
          pathname: "/dashboard",
          location: { jobId: "real-job", view: "rooms", materialListId: null },
        },
      },
      "",
    );
    const first = render(gate());
    fireEvent.click(screen.getByText("Finish tutorial"));
    expect(await screen.findByText("Real Jobs")).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.finish).toHaveBeenCalledWith({
        outcome: "completed",
        expectedUserId: "user-a",
      }),
    );
    expect(getLastJobWorkspaceLocation()).toBeNull();
    expect(window.history.state).toMatchObject({
      __NA: true,
      foremenhqWorkspace: { location: null },
    });
    first.unmount();
    render(gate(true));
    expect(screen.queryByText("Practice Jobs")).not.toBeInTheDocument();
  });

  it("ends offline immediately, preserves a pending exit and retries later", async () => {
    mocks.finish.mockRejectedValue(new Error("Offline"));
    const first = render(gate());
    fireEvent.click(screen.getByText("End tutorial"));
    expect(await screen.findByText("Real Jobs")).toBeInTheDocument();
    await waitFor(() =>
      expect(readTutorialProgress("user-a")).toMatchObject({
        status: "skipped",
        pending: true,
      }),
    );
    first.unmount();
    render(gate(false));
    expect(screen.queryByText("Practice Jobs")).not.toBeInTheDocument();
    mocks.finish.mockResolvedValue({});
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() =>
      expect(readTutorialProgress("user-a")?.pending).toBe(false),
    );
  });

  it("never traps End behind unavailable storage or a failing server", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Blocked");
      },
      setItem: () => {
        throw new Error("Blocked");
      },
      removeItem: () => {
        throw new Error("Blocked");
      },
    });
    mocks.finish.mockRejectedValue(new Error("Offline"));
    render(gate());
    fireEvent.click(screen.getByText("End tutorial"));
    expect(await screen.findByText("Real Jobs")).toBeInTheDocument();
  });

  it("restarts from settings and keeps live children unmounted until Jobs navigation resolves", async () => {
    mocks.pathname = "/dashboard/account/settings";
    const view = render(gate(true));
    fireEvent.click(screen.getByText("Restart tutorial"));
    expect(screen.getByText("Practice Jobs")).toBeInTheDocument();
    expect(screen.queryByText("Real Jobs")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("End tutorial"));
    expect(screen.getByRole("link", { name: "Open Jobs" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.queryByText("Real Jobs")).not.toBeInTheDocument();
    mocks.pathname = "/dashboard";
    view.rerender(gate(true));
    expect(await screen.findByText("Real Jobs")).toBeInTheDocument();
  });

  it("does not let a late finish response complete a restarted run", async () => {
    let finish!: (value: object) => void;
    mocks.finish.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(gate());
    fireEvent.click(screen.getByText("Finish tutorial"));
    await waitFor(() => expect(mocks.finish).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("Restart tutorial"));
    expect(screen.getByText("Practice Jobs")).toBeInTheDocument();
    await act(async () => finish({}));
    await waitFor(() => expect(mocks.restart).toHaveBeenCalledTimes(1));
    expect(readTutorialProgress("user-a")?.status).toBe("active");
    expect(screen.queryByText("Real Jobs")).not.toBeInTheDocument();
  });

  it("keeps completion scoped to each account", async () => {
    stored.set(
      tutorialStorageKey("user-a"),
      JSON.stringify({ status: "skipped", pending: true, token: "old-run" }),
    );
    const view = render(gate(false, "user-a"));
    expect(await screen.findByText("Real Jobs")).toBeInTheDocument();
    view.rerender(gate(false, "user-b"));
    expect(screen.getByText("Practice Jobs")).toBeInTheDocument();
    expect(screen.queryByText("Real Jobs")).not.toBeInTheDocument();
  });

  it.each(["completed", "active"] as const)(
    "preserves synced local %s progress when cached layout disagrees and state read fails",
    async (status) => {
      stored.set(
        tutorialStorageKey("user-a"),
        JSON.stringify({ status, pending: false, token: "synced" }),
      );
      render(gate(status === "active"));
      expect(
        await screen.findByText(
          status === "active" ? "Practice Jobs" : "Real Jobs",
        ),
      ).toBeInTheDocument();
      expect(mocks.state).toHaveBeenCalledTimes(1);
    },
  );

  it("uses authoritative account state before starting when saved snapshots disagree", async () => {
    stored.set(
      tutorialStorageKey("user-a"),
      JSON.stringify({ status: "active", pending: false, token: "synced" }),
    );
    mocks.state.mockResolvedValue({
      userId: "user-a",
      completedAt: new Date(),
    });
    render(gate(true));
    expect(await screen.findByText("Real Jobs")).toBeInTheDocument();
    expect(screen.queryByText("Practice Jobs")).not.toBeInTheDocument();
  });

  it("coalesces reconnect events during a pending restart", async () => {
    let resolveRestart!: (value: object) => void;
    mocks.restart.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRestart = resolve;
      }),
    );
    render(gate(true));
    fireEvent.click(screen.getByText("Restart tutorial"));
    await waitFor(() => expect(mocks.restart).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      resolveRestart({});
    });
    expect(mocks.restart).toHaveBeenCalledTimes(1);
    expect(mocks.restart).toHaveBeenCalledWith({ expectedUserId: "user-a" });
  });

  it("bounds the startup check and ignores a late reply once practice has started", async () => {
    vi.useFakeTimers();
    stored.set(
      tutorialStorageKey("user-a"),
      JSON.stringify({ status: "active", pending: false, token: "synced" }),
    );
    let resolveState!: (value: object) => void;
    mocks.state.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveState = resolve;
      }),
    );
    render(gate(true));
    expect(screen.getByRole("status")).toHaveTextContent("Opening ForemanHQ");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByText("Practice Jobs")).toBeInTheDocument();
    await act(async () => {
      resolveState({ userId: "user-a", completedAt: new Date() });
    });
    expect(screen.getByText("Practice Jobs")).toBeInTheDocument();
    expect(mocks.realMounted).not.toHaveBeenCalled();
  });
});
