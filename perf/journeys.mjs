import fs from "node:fs";
import { expect as playwrightExpect } from "@playwright/test";
const expect = playwrightExpect.configure({ timeout: 60000 });
// Generated exclusively by the disposable seed script. Never infer a real ID.
const fixture = JSON.parse(
  fs.readFileSync(
    process.env.PERF_FIXTURES ?? new URL("./fixtures.json", import.meta.url),
  ),
);
for (const key of [
  "jobId",
  "jobName",
  "materialListId",
  "materialListName",
  "orderId",
  "sheetName",
])
  if (typeof fixture[key] !== "string" || !fixture[key])
    throw new Error(`Missing seeded fixture ${key}`);
const job = `/jobs/${encodeURIComponent(fixture.jobId)}`;
const list = `/jobs/material-lists/${encodeURIComponent(fixture.materialListId)}`;
const paths = {
  coldstart: "/jobs",
  openjob: "/jobs",
  switchjobtabs: job,
  openmateriallist: `${job}/material-lists`,
  changeqty: list,
  receiveline: `${list}?orderId=${encodeURIComponent(fixture.orderId)}`,
  opensheetpinch: `${job}/drawings`,
  sendchat: `${job}/chat`,
};
const painted = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
export async function prepare({ page, base, journey }) {
  if (journey === "coldstart") return;
  await page.goto(new URL(paths[journey], base).href);
  // Confirm the isolated build actually established an app identity before timing.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  if (page.url().includes("sign-in"))
    throw new Error("Lab authentication not established");
  if (journey === "openjob")
    await expect(
      page.getByText(fixture.jobName, { exact: true }).first(),
    ).toBeVisible();
  if (journey === "switchjobtabs")
    await expect(
      page.locator('[data-job-card="material-lists"]'),
    ).toBeVisible();
  if (journey === "openmateriallist")
    await expect(
      page.getByText(fixture.materialListName, { exact: true }).first(),
    ).toBeVisible();
  if (journey === "changeqty")
    await expect(
      page
        .getByRole("button", { name: "Increase quantity", exact: true })
        .first(),
    ).toBeVisible();
  if (journey === "receiveline")
    await expect(
      page
        .getByRole("button", { name: /^(Verify part|Part verified complete)$/ })
        .first(),
    ).toBeVisible();
  if (journey === "opensheetpinch") {
    await page
      .getByRole("button", {
        name: `Open ${fixture.setName ?? "Synthetic 40 Sheet Set"}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: `Open ${fixture.sheetName}`,
        exact: true,
      }),
    ).toBeVisible();
  }
  if (journey === "sendchat")
    await expect(
      page.getByPlaceholder("Message everyone on this job…"),
    ).toBeVisible();
  // Visited-screen journeys warm the destination through the real client router,
  // then return through browser history before the timed second navigation.
  if (["openjob", "switchjobtabs", "openmateriallist"].includes(journey)) {
    const source = page.url();
    await { openjob, switchjobtabs, openmateriallist }[journey]({ page });
    await page.goBack();
    await expect(page).toHaveURL(source);
    if (journey === "openjob")
      await expect(
        page.getByText(fixture.jobName, { exact: true }).first(),
      ).toBeVisible();
    if (journey === "switchjobtabs")
      await expect(
        page.locator('[data-job-card="material-lists"]'),
      ).toBeVisible();
    if (journey === "openmateriallist")
      await expect(
        page.getByText(fixture.materialListName, { exact: true }).first(),
      ).toBeVisible();
  }
  await painted(page);
}
export async function coldstart({ page, base }) {
  await page.goto(new URL("/jobs", base).href);
  await expect(
    page.getByText(fixture.jobName, { exact: true }).first(),
  ).toBeVisible();
  await painted(page);
}
export async function openjob({ page }) {
  await page.getByText(fixture.jobName, { exact: true }).first().click();
  await expect(page.locator('[data-job-card="material-lists"]')).toBeVisible();
  await painted(page);
}
export async function switchjobtabs({ page }) {
  await page.locator('[data-job-card="material-lists"]').click();
  await expect(
    page.getByText(fixture.materialListName, { exact: true }).first(),
  ).toBeVisible();
  await painted(page);
}
export async function openmateriallist({ page }) {
  await page
    .getByText(fixture.materialListName, { exact: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("button", { name: "Increase quantity", exact: true })
      .first(),
  ).toBeVisible();
  await painted(page);
}
export async function changeqty({ page }) {
  const input = page
    .getByRole("textbox", { name: "Quantity", exact: true })
    .first();
  const old = await input.inputValue();
  await page
    .getByRole("button", { name: "Increase quantity", exact: true })
    .first()
    .click();
  await expect(input).not.toHaveValue(old);
  await painted(page);
}
export async function receiveline({ page }) {
  const button = page
    .getByRole("button", { name: /^(Verify part|Part verified complete)$/ })
    .first();
  const before = await button.getAttribute("aria-pressed");
  await button.click();
  await expect(button).toHaveAttribute(
    "aria-pressed",
    before === "true" ? "false" : "true",
  );
  await painted(page);
}
export async function sendchat({ page, run }) {
  const text = `Synthetic speed lab message ${run} ${Date.now()}`;
  await page.getByPlaceholder("Message everyone on this job…").fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.locator("[data-chat-message-id]").filter({ hasText: text }),
  ).toBeVisible();
  await painted(page);
}
export async function opensheetpinch({ page, cdp }) {
  await page
    .getByRole("button", { name: `Open ${fixture.sheetName}`, exact: true })
    .click();
  await expect(
    page.locator("[data-drawing-image-layer] img").first(),
  ).toBeVisible();
  await cdp.send("Input.synthesizePinchGesture", {
    x: 180,
    y: 400,
    scaleFactor: 2,
    relativeSpeed: 800,
    gestureSourceType: "touch",
  });
  // Sharp means physical pixel coverage, not a timeout or a merely mounted canvas.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const sheet = document.querySelector(
            "[data-drawing-image-layer] img",
          );
          if (!sheet || !sheet.complete || !sheet.naturalWidth) return false;
          const b = sheet.getBoundingClientRect();
          const tiles = [
            ...document.querySelectorAll("canvas[data-pdf-detail]"),
          ]
            .filter((c) => c.style.visibility === "visible" && c.width > 0)
            .map((c) => ({
              box: c.getBoundingClientRect(),
              density:
                c.width / c.getBoundingClientRect().width / devicePixelRatio,
            }));
          for (let i = 0; i < 10; i++)
            for (let j = 0; j < 10; j++) {
              const x =
                Math.max(0, b.left) +
                ((i + 0.5) / 10) *
                  (Math.min(innerWidth, b.right) - Math.max(0, b.left));
              const y =
                Math.max(0, b.top) +
                ((j + 0.5) / 10) *
                  (Math.min(innerHeight, b.bottom) - Math.max(0, b.top));
              if (
                !tiles.some(
                  (t) =>
                    t.density >= 0.95 &&
                    x >= t.box.left &&
                    x <= t.box.right &&
                    y >= t.box.top &&
                    y <= t.box.bottom,
                )
              )
                return false;
            }
          return true;
        }),
      { timeout: 120000 },
    )
    .toBe(true);
  await painted(page);
}
export async function staticMetrics() {
  if (!process.env.PERF_STATIC_REPORT && process.env.PERF_PILOT)
    return undefined;
  if (!process.env.PERF_STATIC_REPORT)
    throw new Error(
      "PERF_STATIC_REPORT required: measured build bytes/polls, never guessed",
    );
  return JSON.parse(fs.readFileSync(process.env.PERF_STATIC_REPORT));
}
