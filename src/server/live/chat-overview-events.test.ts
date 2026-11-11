// @vitest-environment node
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  acceptBackgroundHint,
  transactionalBackgroundHint,
} from "~/server/background/hints";
import { subscribeChatOverviewEvents } from "./chat-overview-events";
it("matches exact organization, actor and admitted job, including effective-user sessions", () => {
  const self = vi.fn(),
    simulation = vi.fn(),
    peer = vi.fn(),
    foreign = vi.fn(),
    otherJob = vi.fn();
  const callbacks = [self, simulation, peer, foreign, otherJob];
  const audiences = [
    { organizationId: "org", userId: "a", jobIds: new Set(["job"]) },
    { organizationId: "org", userId: "a", jobIds: new Set(["job"]) },
    { organizationId: "org", userId: "b", jobIds: new Set(["job"]) },
    { organizationId: "other", userId: "a", jobIds: new Set(["job"]) },
    { organizationId: "org", userId: "a", jobIds: new Set(["other"]) },
  ];
  const stops = audiences.map((a, i) =>
    subscribeChatOverviewEvents(a, callbacks[i]!),
  );
  acceptBackgroundHint(
    transactionalBackgroundHint({
      topic: "chat-overview",
      organizationId: "org",
      userId: "a",
      jobId: "job",
      eventId: randomUUID(),
    }),
  );
  expect(self).toHaveBeenCalledOnce();
  expect(simulation).toHaveBeenCalledOnce();
  expect(peer).not.toHaveBeenCalled();
  expect(foreign).not.toHaveBeenCalled();
  expect(otherJob).not.toHaveBeenCalled();
  stops.forEach((stop) => stop());
  acceptBackgroundHint(
    transactionalBackgroundHint({
      topic: "chat-overview",
      organizationId: "org",
      userId: "a",
      jobId: "job",
      eventId: randomUUID(),
    }),
  );
  expect(self).toHaveBeenCalledOnce();
});
it("resyncs admitted jobs on LISTEN reestablishment and stops after cleanup", () => {
  const callback = vi.fn();
  const stop = subscribeChatOverviewEvents(
    { organizationId: "org", userId: "a", jobIds: new Set(["one", "two"]) },
    callback,
  );
  const state = (
    globalThis as typeof globalThis & {
      __foremanBackgroundHints: {
        emitter: { emit: (event: string, revision: string) => void };
      };
    }
  ).__foremanBackgroundHints;
  state.emitter.emit("reconnected", "epoch");
  expect(callback.mock.calls).toEqual([
    ["one", "resync", "epoch"],
    ["two", "resync", "epoch"],
  ]);
  stop();
  state.emitter.emit("reconnected", "later");
  expect(callback).toHaveBeenCalledTimes(2);
});
