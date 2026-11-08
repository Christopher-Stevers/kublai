// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { devFeaturesEnabled } from "./dev-features";

afterEach(() => vi.unstubAllEnvs());
it.each([
  ["production", undefined, undefined, false],
  ["development", undefined, undefined, true],
  ["production", "true", "development", true],
  ["production", "true", "production", false],
  ["development", "true", "production", false],
  ["development", "false", undefined, false],
  ["production", "false", "development", false],
  ["production", "yes", undefined, false],
] as const)("gates NODE_ENV=%s flag=%s deployment=%s", (node, flag, deployment, enabled) => {
  vi.stubEnv("NODE_ENV", node);
  vi.stubEnv("FOREMANHQ_DEV_FEATURES", flag);
  vi.stubEnv("DEPLOY_ENVIRONMENT", deployment);
  expect(devFeaturesEnabled()).toBe(enabled);
});
