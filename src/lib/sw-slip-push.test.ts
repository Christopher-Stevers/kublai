// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("opens a slip received without a check only on its own review", () => {
  const context = {
    self: {
      addEventListener: vi.fn(),
      location: { origin: "https://test.local" },
    },
    URL,
    console,
  };
  runInNewContext(
    readFileSync("public/sw.js", "utf8") +
      "\nglobalThis.pushUrl = safePushUrl;",
    context,
  );
  const pushUrl = (
    context as typeof context & {
      pushUrl: (data: unknown) => string | null;
    }
  ).pushUrl;
  const job = "00000000-0000-4000-8000-000000000002",
    document = "00000000-0000-4000-8000-000000000009";
  const slip = (url: string) => pushUrl({ type: "slip-received", url });
  expect(slip(`/jobs/${job}/receiving?document=${document}`)).toBe(
    `https://test.local/jobs/${job}/receiving?document=${document}`,
  );
  for (const url of [
    `https://other.test/jobs/${job}/receiving?document=${document}`,
    `/jobs/${job}/receiving`,
    `/jobs/${job}/receiving?document=${document}&next=/x`,
    `/jobs/${job}/receiving?document=${document}#x`,
    `/jobs/${job}/documents?document=${document}`,
    `/jobs/${job}/receiving?document=../x`,
  ])
    expect(slip(url)).toBeNull();
});
