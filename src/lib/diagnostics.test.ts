import { expect, it } from "vitest";
import {
  diagnosticEvent,
  diagnosticFeatureFor,
  diagnosticErrorCode,
} from "./diagnostics";
const event = {
  kind: "action_failed",
  feature: "rooms",
  device: "touch",
  release: "838ef32",
  code: "server",
  duration: "under_10s",
};
it("accepts only bounded diagnostic categories, never free text or IDs", () => {
  expect(diagnosticEvent.safeParse(event).success).toBe(true);
  for (const extra of [
    { message: "private text" },
    { url: "/jobs/private" },
    { userId: "person" },
    { screenshot: "pixels" },
  ])
    expect(diagnosticEvent.safeParse({ ...event, ...extra }).success).toBe(
      false,
    );
  expect(
    diagnosticEvent.safeParse({ ...event, feature: "private job name" })
      .success,
  ).toBe(false);
  expect(
    diagnosticEvent.safeParse({ ...event, release: "secret token" }).success,
  ).toBe(false);
});
it("reduces errors and router paths to fixed categories", () => {
  expect(
    diagnosticErrorCode({
      message: "PRIVATE SQL ERROR",
      data: { httpStatus: 500 },
    }),
  ).toBe("server");
  expect(diagnosticErrorCode(new Error("private message"))).toBe("unknown");
  expect(diagnosticFeatureFor("rooms")).toBe("rooms");
  expect(diagnosticFeatureFor("private name")).toBe("other");
});
