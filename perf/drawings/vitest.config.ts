import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "perf/drawings/operators.test.ts",
      "perf/drawings/stroke-style.test.ts",
      "perf/drawings/replay-support.test.ts",
      "perf/drawings/fidelity.test.ts",
      "perf/drawings/stroke-v3-invocation.test.ts",
    ],
    environment: "node",
  },
});
