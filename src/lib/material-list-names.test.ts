import { describe, expect, it } from "vitest";
import {
  formatMaterialListDate,
  getNextMaterialListNameFromNames,
  isDefaultMaterialListName,
} from "./material-list-names";

const friday = new Date("2026-10-23T16:00:00Z");
describe("automatic material-list names", () => {
  it("uses the weekday, day/month/two-digit year, and leaves the first list unnumbered", () => {
    expect(formatMaterialListDate(friday)).toBe("Friday 23/10/26");
    expect(getNextMaterialListNameFromNames([], friday)).toBe(
      "Friday 23/10/26",
    );
    expect(formatMaterialListDate(new Date("2027-01-01T16:00:00Z"))).toBe(
      "Friday 01/01/27",
    );
  });
  it("starts suffixes at two and still accepts previous first-list suffixes", () => {
    expect(getNextMaterialListNameFromNames(["Friday 23/10/26"], friday)).toBe("Friday 23/10/26-2");
    expect(getNextMaterialListNameFromNames(["Friday 23/10/26-1"], friday)).toBe("Friday 23/10/26-2");
    expect(isDefaultMaterialListName("Friday 23/10/26")).toBe(true);
  });
  it("continues the day's sequence without reusing a deleted lower number", () => {
    expect(
      getNextMaterialListNameFromNames(
        [
          "Friday 23/10/26-2",
          "Friday 23/10/26-4",
          "Thursday 22/10/26-99",
          "Custom list",
          null,
        ],
        friday,
      ),
    ).toBe("Friday 23/10/26-5");
  });
  it("counts existing names from the old format without renaming them", () => {
    const names = [
      "October 23, 2026",
      "October 23, 2026 - 2",
      " Friday 23/10/26-3 ",
    ];
    expect(getNextMaterialListNameFromNames(names, friday)).toBe(
      "Friday 23/10/26-4",
    );
    expect(names[0]).toBe("October 23, 2026");
  });
  it("uses the Toronto calendar day across midnight and the daylight-saving change", () => {
    expect(
      getNextMaterialListNameFromNames([], new Date("2026-10-24T01:00:00Z")),
    ).toBe("Friday 23/10/26");
    expect(
      getNextMaterialListNameFromNames([], new Date("2026-11-01T06:30:00Z")),
    ).toBe("Sunday 01/11/26");
    expect(
      getNextMaterialListNameFromNames([], new Date("2026-11-02T05:00:00Z")),
    ).toBe("Monday 02/11/26");
  });
  it("recognizes new and legacy auto names while preserving custom titles", () => {
    for (const name of [
      null,
      "Material List",
      "October 23, 2026 - 2",
      "Friday 23/10/26-1",
    ])
      expect(isDefaultMaterialListName(name)).toBe(true);
    for (const name of [
      "Roof drainage",
      "Kitchen — Friday 23/10/26",
      "Friday 23/10/2026-1",
      "Friday 23/10/26-0",
    ])
      expect(isDefaultMaterialListName(name)).toBe(false);
  });
});
