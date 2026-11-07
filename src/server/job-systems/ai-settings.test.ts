// @vitest-environment node
import { mkdtemp, readFile, mkdir, copyFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
it("encrypts company credentials, rejects cross-company copies, and defaults to hosted", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "assessment-ai-"));
  vi.stubEnv("ASSESSMENT_STORAGE_ROOT", root);
  vi.resetModules();
  try {
    const { readAssessmentAi, storeAssessmentAi, hostedSettings } =
      await import("./ai-settings");
    const a = "00000000-0000-4000-8000-000000000001",
      b = "00000000-0000-4000-8000-000000000002";
    expect((await readAssessmentAi(a)).mode).toBe("hosted");
    const settings = {
      ...hostedSettings,
      mode: "custom" as const,
      baseUrl: "https://example.com/v1",
      model: "example",
      apiKey: "secret-test-key",
    };
    await storeAssessmentAi(a, settings);
    expect(await readAssessmentAi(a)).toEqual(settings);
    const file = path.join(root, a, "connection.json");
    expect(await readFile(file, "utf8")).not.toContain("secret-test-key");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await mkdir(path.join(root, b));
    await copyFile(file, path.join(root, b, "connection.json"));
    await expect(readAssessmentAi(b)).rejects.toThrow();
    const run = "00000000-0000-4000-8000-000000000003";
    await storeAssessmentAi(a, settings, run);
    await storeAssessmentAi(a, hostedSettings);
    expect(await readAssessmentAi(a, run)).toEqual(settings);
    await expect(readAssessmentAi(b, run)).rejects.toThrow(
      "snapshot is missing",
    );
    expect((await readAssessmentAi(a)).apiKey).toBe("");
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
