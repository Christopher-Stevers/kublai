import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  acceptBackgroundHint,
  transactionalBackgroundHint,
} from "../background/hints";
import { subscribeMaterialSortEvents } from "./material-sort-events";
it("routes own-process postcommit hints to org executives and effective personal audiences only", () => {
  const direct = vi.fn(),
    simulated = vi.fn(),
    other = vi.fn(),
    foreign = vi.fn();
  const stops = [
    subscribeMaterialSortEvents(
      { organizationId: "org", userId: "crew" },
      direct,
    ),
    subscribeMaterialSortEvents(
      { organizationId: "org", userId: "crew" },
      simulated,
    ),
    subscribeMaterialSortEvents(
      { organizationId: "org", userId: "other" },
      other,
    ),
    subscribeMaterialSortEvents(
      { organizationId: "foreign", userId: "crew" },
      foreign,
    ),
  ];
  const send = (scope: "personal" | "executive") =>
    acceptBackgroundHint(
      transactionalBackgroundHint({
        topic: "preferences",
        organizationId: "org",
        scope,
        ...(scope === "personal" ? { userId: "crew" } : {}),
        eventId: randomUUID(),
      }),
    );
  send("personal");
  expect(direct).toHaveBeenCalledOnce();
  expect(simulated).toHaveBeenCalledOnce();
  expect(other).not.toHaveBeenCalled();
  expect(foreign).not.toHaveBeenCalled();
  send("executive");
  expect(other).toHaveBeenCalledOnce();
  expect(foreign).not.toHaveBeenCalled();
  stops.forEach((stop) => stop());
  send("personal");
  expect(direct).toHaveBeenCalledTimes(2);
});
it("rejects ambiguous preference audiences", () => {
  expect(() =>
    transactionalBackgroundHint({
      topic: "preferences",
      organizationId: "org",
      scope: "personal",
      eventId: randomUUID(),
    }),
  ).toThrow();
  expect(() =>
    transactionalBackgroundHint({
      topic: "preferences",
      organizationId: "org",
      scope: "executive",
      userId: "crew",
      eventId: randomUUID(),
    }),
  ).toThrow();
});
it("uses one LISTEN epoch revision for all catch-up listeners and cleans them up", () => {
  const a = vi.fn(),
    b = vi.fn();
  const stopA = subscribeMaterialSortEvents(
      { organizationId: "org", userId: "a" },
      a,
    ),
    stopB = subscribeMaterialSortEvents(
      { organizationId: "org", userId: "b" },
      b,
    );
  const state = (
    globalThis as typeof globalThis & {
      __foremanBackgroundHints: {
        emitter: { emit: (event: string, revision: string) => void };
      };
    }
  ).__foremanBackgroundHints;
  state.emitter.emit("reconnected", "shared-listen-epoch");
  expect(a).toHaveBeenCalledWith("resync", "shared-listen-epoch");
  expect(b).toHaveBeenCalledWith("resync", "shared-listen-epoch");
  stopA();
  stopB();
  state.emitter.emit("reconnected", "next-epoch");
  expect(a).toHaveBeenCalledOnce();
  expect(b).toHaveBeenCalledOnce();
});
