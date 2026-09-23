// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./jev", () => ({ askJev: vi.fn(async () => ({ model: "simulated", answers: {} })) }));
import { askJev } from "./jev";
import { askJevCached } from "./cached-jev";
afterEach(() => vi.unstubAllEnvs());
it("shares exact runs only within the same organization, inputs, model and credential", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "simulated-key");
  const request = { state: { part: "8 inch fitting" }, questions: {} };
  await Promise.all([askJevCached("a", request), askJevCached("a", request)]);
  expect(askJev).toHaveBeenCalledTimes(1);
  await askJevCached("b", request);
  await askJevCached("a", { ...request, state: { part: "renamed part" } });
  vi.stubEnv("TYPESAFE_MODEL", "new-model");
  await askJevCached("a", request);
  vi.stubEnv("TYPESAFE_API_KEY", "rotated-simulated-key");
  await askJevCached("a", request);
  expect(askJev).toHaveBeenCalledTimes(5);
});
