import { expect, it } from "vitest";
import { isDevOnlyPage } from "./dev-only-pages";
it.each(["draws", "estimating", "timesheets", "assets"])("recognizes %s and nested destinations", (page) => {
  expect(isDevOnlyPage(`/jobs/${page}`)).toBe(true);
  expect(isDevOnlyPage(`/jobs/${page}/record?tab=one#position`)).toBe(true);
});
it.each(["/jobs/orders", "/jobs", "/jobs/job-id/material-lists", "/jobs/quotes", "/jobs/drawings", "/jobs/assets-other"])("preserves %s", (path) => {
  expect(isDevOnlyPage(path)).toBe(false);
});
