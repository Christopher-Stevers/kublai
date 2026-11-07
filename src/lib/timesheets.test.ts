import { describe, expect, it } from "vitest";
import {
  clockDays,
  dateInput,
  defaultTimeSettings,
  entryInput,
  localDate,
  settingsInput,
  timeCsv,
  timePeriod,
} from "./timesheets";
import { resolvePermissions } from "~/server/auth/permissions";

describe("company time periods and validation", () => {
  it("anchors weekly submissions to the company's weekday across year boundaries", () => {
    expect(timePeriod("2027-01-01", defaultTimeSettings)).toEqual({
      start: "2026-12-28",
      end: "2027-01-03",
    });
    expect(
      timePeriod("2026-10-08", { ...defaultTimeSettings, weekStartsOn: 0 }),
    ).toEqual({ start: "2026-10-04", end: "2026-10-10" });
    expect(
      timePeriod("2026-10-08", { ...defaultTimeSettings, cadence: "daily" }),
    ).toEqual({ start: "2026-10-08", end: "2026-10-08" });
  });
  it.each(["2026-02-30", "2026-13-01", "bad", "1999-01-01"])(
    "rejects invalid date %s",
    (value) => expect(dateInput.safeParse(value).success).toBe(false),
  );
  it("validates time zones, integer breaks and total day length", () => {
    expect(
      settingsInput.safeParse({
        ...defaultTimeSettings,
        timezone: "Invalid/place",
      }).success,
    ).toBe(false);
    const entry = {
      id: crypto.randomUUID(),
      date: "2026-10-08",
      jobId: null,
      category: "work",
      minutes: 450,
      breakMinutes: 30,
      costCode: "",
      notes: "",
    };
    expect(entryInput.safeParse(entry).success).toBe(true);
    expect(entryInput.safeParse({ ...entry, breakMinutes: 1.5 }).success).toBe(
      false,
    );
    expect(entryInput.safeParse({ ...entry, minutes: 1440 }).success).toBe(
      false,
    );
  });
  it("gives workers personal entry access but keeps management company-controlled", () => {
    const worker = resolvePermissions({ role: "worker" });
    expect(worker["tab.timesheets"]).toBe(true);
    expect(worker["timesheets.edit"]).toBe(true);
    expect(worker["timesheets.manage"]).toBe(false);
    expect(resolvePermissions({ role: "admin" })["timesheets.manage"]).toBe(
      true,
    );
    expect(
      resolvePermissions({
        role: "worker",
        permissionConfig: {
          version: 2,
          permissions: { "tab.timesheets": false },
        },
      })["tab.timesheets"],
    ).toBe(false);
  });
});

describe("durable clock accounting", () => {
  const tz = "America/Toronto";
  it("splits at local midnight and deducts breaks once", () => {
    expect(
      clockDays(
        [
          {
            start: "2026-10-09T03:30:00Z",
            end: "2026-10-09T04:30:00Z",
            kind: "work",
          },
          {
            start: "2026-10-09T04:30:00Z",
            end: "2026-10-09T04:45:00Z",
            kind: "break",
          },
          { start: "2026-10-09T04:45:00Z", end: null, kind: "work" },
        ],
        new Date("2026-10-09T05:45:00Z"),
        tz,
      ),
    ).toEqual([
      { date: "2026-10-08", minutes: 30, breakMinutes: 0 },
      { date: "2026-10-09", minutes: 90, breakMinutes: 15 },
    ]);
  });
  it("uses elapsed time through spring and fall DST changes", () => {
    for (const [start, end, minutes] of [
      ["2026-03-08T06:00:00Z", "2026-03-08T08:00:00Z", 120],
      ["2026-11-01T05:00:00Z", "2026-11-01T07:00:00Z", 120],
    ] as const)
      expect(
        clockDays([{ start, end, kind: "work" }], new Date(end), tz)[0]
          ?.minutes,
      ).toBe(minutes);
    expect(localDate(new Date("2026-10-09T03:30:00Z"), tz)).toBe("2026-10-08");
  });
  it("splits multiple midnights and bounds forgotten timers", () => {
    const result = clockDays(
      [
        {
          start: "2026-10-08T22:00:00Z",
          end: "2026-10-11T02:00:00Z",
          kind: "work",
        },
      ],
      new Date(),
      "UTC",
    );
    expect(result.map((d) => d.minutes)).toEqual([120, 1440, 1440, 120]);
    expect(() =>
      clockDays(
        [{ start: "2026-08-01T00:00:00Z", end: null, kind: "work" }],
        new Date("2026-10-01T00:00:00Z"),
        tz,
      ),
    ).toThrow("over a month");
  });
  it("rounds only after summing work intervals and refuses malformed intervals", () => {
    const result = clockDays(
      [
        {
          start: "2026-10-08T12:00:00Z",
          end: "2026-10-08T12:00:20Z",
          kind: "work",
        },
        {
          start: "2026-10-08T12:01:00Z",
          end: "2026-10-08T12:01:20Z",
          kind: "work",
        },
      ],
      new Date(),
      tz,
    );
    expect(result[0]?.minutes).toBe(1);
    expect(() =>
      clockDays([{ start: "bad", end: null, kind: "work" }], new Date(), tz),
    ).toThrow();
  });
});

it("CSV keeps quotes/newlines and neutralizes spreadsheet formulas", () => {
  const csv = timeCsv([
    {
      Employee: '=HYPERLINK("bad")',
      Notes: 'two\n"lines"',
      Hours: "7.50",
      Job: " @evil",
    },
  ]);
  expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  expect(csv).toContain('"two\n""lines"""');
  expect(csv).toContain('"\' @evil"');
  expect(csv).toContain('"7.50"');
});
