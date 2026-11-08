import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); } }));
import Draws from "~/app/jobs/draws/layout";
import Estimating from "~/app/jobs/estimating/layout";
import Timesheets from "~/app/jobs/timesheets/layout";
import Assets from "~/app/jobs/assets/layout";
afterEach(() => vi.unstubAllEnvs());
it.each([Draws, Estimating, Timesheets, Assets])("blocks direct and nested module pages when disabled", (Layout) => {
  vi.stubEnv("FOREMANHQ_DEV_FEATURES", "false");
  expect(() => Layout({ children: "private workspace" })).toThrow("NOT_FOUND");
  vi.stubEnv("FOREMANHQ_DEV_FEATURES", "true");
  expect(Layout({ children: "private workspace" })).toBe("private workspace");
});
