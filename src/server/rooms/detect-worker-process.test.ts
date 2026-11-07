import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  spawn: vi.fn(),
  claim: vi.fn(),
  fail: vi.fn(),
  pid: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: mocked.spawn, default: { spawn: mocked.spawn } }));
vi.mock("./detect-queue", () => ({ claimNextDetectJob: mocked.claim }));
vi.mock("~/server/rooms/detect-job", () => ({
  failDetectJob: mocked.fail,
  setDetectWorkerPid: mocked.pid,
}));
import { dispatchDetectQueue } from "./detect-worker-process";

class Worker extends EventEmitter {
  pid = 789123;
  unref = vi.fn();
}
const first = { floorId: "first-floor", runId: "first-run" };
const second = { floorId: "second-floor", runId: "second-run" };

beforeEach(() => {
  vi.clearAllMocks();
  mocked.claim.mockReset().mockResolvedValue(null);
  mocked.spawn.mockReset();
  mocked.fail.mockReset().mockResolvedValue(undefined);
  mocked.pid.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

function launchedWorker() {
  const worker = new Worker();
  queueMicrotask(() => worker.emit("spawn"));
  return worker;
}

describe("durable detection dispatcher", () => {
  it("coalesces concurrent timer kicks and starts only the claimed floor", async () => {
    mocked.claim.mockResolvedValueOnce(first);
    const workers: Worker[] = [];
    mocked.spawn.mockImplementation(() => {
      const worker = launchedWorker();
      workers.push(worker);
      return worker;
    });
    await Promise.all([
      dispatchDetectQueue(),
      dispatchDetectQueue(),
      dispatchDetectQueue(),
    ]);
    expect(mocked.claim).toHaveBeenCalledTimes(1);
    expect(mocked.spawn).toHaveBeenCalledTimes(1);
    expect(mocked.spawn.mock.calls[0]?.[1]).toEqual([
      first.floorId,
      "complete",
      first.runId,
    ]);
    expect(mocked.pid).toHaveBeenCalledWith(
      first.floorId,
      workers[0]?.pid,
      first.runId,
    );
    expect(workers[0]?.unref).toHaveBeenCalledOnce();
  });

  it("records a launch failure and immediately advances to the next queued sheet", async () => {
    mocked.claim.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    mocked.spawn
      .mockImplementationOnce(() => {
        const worker = new Worker();
        queueMicrotask(() =>
          worker.emit("error", new Error("Spawn unavailable")),
        );
        return worker;
      })
      .mockImplementationOnce(launchedWorker);
    await dispatchDetectQueue();
    expect(mocked.fail).toHaveBeenCalledWith(
      first.floorId,
      "Spawn unavailable",
      first.runId,
    );
    expect(mocked.pid).toHaveBeenCalledWith(
      second.floorId,
      expect.any(Number),
      second.runId,
    );
    expect(mocked.claim).toHaveBeenCalledTimes(2);
  });

  it.each([0, 1])(
    "advances after worker exit %s, even when the browser is gone",
    async (code) => {
      mocked.claim.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
      const workers: Worker[] = [];
      mocked.spawn.mockImplementation(() => {
        const worker = launchedWorker();
        workers.push(worker);
        return worker;
      });
      await dispatchDetectQueue();
      workers[0]!.emit("exit", code, null);
      await vi.waitFor(() =>
        expect(mocked.pid).toHaveBeenCalledWith(
          second.floorId,
          expect.any(Number),
          second.runId,
        ),
      );
      expect(mocked.fail).toHaveBeenCalledWith(
        first.floorId,
        `Room detection worker stopped (exit code ${code})`,
        first.runId,
      );
    },
  );

  it("kills its own newly spawned group if worker identity cannot be persisted", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    mocked.claim.mockResolvedValueOnce(first);
    mocked.spawn.mockImplementation(launchedWorker);
    mocked.pid.mockRejectedValueOnce(new Error("Database unavailable"));
    await dispatchDetectQueue();
    expect(kill).toHaveBeenCalledWith(-789123, "SIGKILL");
    expect(mocked.fail).toHaveBeenCalledWith(
      first.floorId,
      "Database unavailable",
      first.runId,
    );
  });

  it("retries dispatcher database failures on the next timer tick", async () => {
    mocked.claim.mockRejectedValueOnce(
      new Error("Database temporarily unavailable"),
    );
    await expect(dispatchDetectQueue()).rejects.toThrow(
      "Database temporarily unavailable",
    );
    mocked.claim.mockResolvedValueOnce(first);
    mocked.spawn.mockImplementation(launchedWorker);
    await dispatchDetectQueue();
    expect(mocked.spawn).toHaveBeenCalledOnce();
  });
});
