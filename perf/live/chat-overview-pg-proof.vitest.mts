import { defineConfig } from "vitest/config";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
export default defineConfig({
  test: {
    environment: "node",
    include: ["perf/live/chat-overview-pg-proof.ts"],
    maxWorkers: 1,
    testTimeout: 10000,
    hookTimeout: 15000,
  },
  resolve: {
    alias: [
      {
        find: "~/server/db/schema",
        replacement:
          "/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r19-20261111/src/server/db/schema.ts",
      },
      { find: "~", replacement: path.join(root, "src") },
    ],
  },
});
