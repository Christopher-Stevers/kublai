// @vitest-environment node
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  acceptBackgroundHint,
  transactionalBackgroundHint,
} from "~/server/background/hints";
import { subscribeTimesheetEvents } from "./timesheet-events";
it("filters personal/manager/org/foreign audiences and permits effective-user simulation scope", () => {
  const self = vi.fn(),
    simulated = vi.fn(),
    peer = vi.fn(),
    manager = vi.fn(),
    foreign = vi.fn();
  const stops = [
    subscribeTimesheetEvents(
      { organizationId: "org", userId: "a", canManage: false },
      self,
    ),
    subscribeTimesheetEvents(
      { organizationId: "org", userId: "a", canManage: false },
      simulated,
    ),
    subscribeTimesheetEvents(
      { organizationId: "org", userId: "b", canManage: false },
      peer,
    ),
    subscribeTimesheetEvents(
      { organizationId: "org", userId: "m", canManage: true },
      manager,
    ),
    subscribeTimesheetEvents(
      { organizationId: "foreign", userId: "a", canManage: true },
      foreign,
    ),
  ];
  acceptBackgroundHint(
    transactionalBackgroundHint({
      topic: "timesheets",
      organizationId: "org",
      scope: "personal",
      userId: "a",
      eventId: randomUUID(),
    }),
  );
  expect(self).toHaveBeenCalledOnce();
  expect(simulated).toHaveBeenCalledOnce();
  expect(manager).toHaveBeenCalledOnce();
  expect(peer).not.toHaveBeenCalled();
  expect(foreign).not.toHaveBeenCalled();
  acceptBackgroundHint(
    transactionalBackgroundHint({
      topic: "timesheets",
      organizationId: "org",
      scope: "organization",
      eventId: randomUUID(),
    }),
  );
  expect(peer).toHaveBeenCalledOnce();
  expect(foreign).not.toHaveBeenCalled();
  stops.forEach((stop) => stop());
});
it("rejects ambiguous personal/org payloads", () => {
  expect(() =>
    transactionalBackgroundHint({
      topic: "timesheets",
      organizationId: "org",
      scope: "personal",
      eventId: randomUUID(),
    }),
  ).toThrow();
  expect(() =>
    transactionalBackgroundHint({
      topic: "timesheets",
      organizationId: "org",
      scope: "organization",
      userId: "a",
      eventId: randomUUID(),
    }),
  ).toThrow();
});
it("reconciles LISTEN reset and removes all callbacks on cleanup", () => {
  const callback = vi.fn();
  const stop = subscribeTimesheetEvents(
    { organizationId: "org", userId: "a", canManage: false },
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
  expect(callback).toHaveBeenCalledWith("resync", "epoch");
  stop();
  state.emitter.emit("reconnected", "next");
  expect(callback).toHaveBeenCalledOnce();
});
