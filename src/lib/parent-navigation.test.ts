import { expect, it } from "vitest";
import { parentRoute } from "./parent-navigation";
it.each([
  ["/dashboard/jobs/alma/drawings", "/dashboard/jobs/alma"],
  ["/dashboard/jobs/alma/systems", "/dashboard/jobs/alma"],
  ["/dashboard/jobs/alma/material-lists", "/dashboard/jobs/alma"],
  ["/dashboard/jobs/alma/chat", "/dashboard/jobs/alma"],
  ["/dashboard/jobs/alma", "/dashboard"],
  ["/dashboard/account/settings", "/dashboard/account"],
  ["/dashboard/estimating/estimate-1", "/dashboard/estimating"],
  ["/dashboard/assets/tools/tool-1", "/dashboard/assets/tools"],
  ["/dashboard/catalogue", "/dashboard"],
  ["/dashboard", "/dashboard"],
])("%s goes up to %s", (path, parent) => expect(parentRoute(path)).toBe(parent));
