import { expect, it } from "vitest";
import { parentRoute } from "./parent-navigation";
it.each([
  ["/jobs/alma/drawings", "/jobs/alma"],
  ["/jobs/alma/systems", "/jobs/alma"],
  ["/jobs/alma/material-lists", "/jobs/alma"],
  ["/jobs/alma/chat", "/jobs/alma"],
  ["/jobs/alma", "/jobs"],
  ["/jobs/account/settings", "/jobs/account"],
  ["/jobs/estimating/estimate-1", "/jobs/estimating"],
  ["/jobs/assets/tools/tool-1", "/jobs/assets/tools"],
  ["/jobs/catalogue", "/jobs"],
  ["/jobs", "/jobs"],
])("%s goes up to %s", (path, parent) => expect(parentRoute(path)).toBe(parent));
