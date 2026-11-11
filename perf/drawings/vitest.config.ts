import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["perf/drawings/operators.test.ts"], environment: "node" },
});
