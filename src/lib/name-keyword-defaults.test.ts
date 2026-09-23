import { beforeEach, describe, expect, it } from "vitest";
import {
  loadNameKeywordGroups,
  NAME_KEYWORDS_KEY,
  NAME_KEYWORDS_ROLLOUT,
  SHARED_NAME_KEYWORD_GROUPS,
} from "./name-keyword-defaults";
describe("shared keyword rollout", () => {
  const entries = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    clear: () => entries.clear(),
  };
  beforeEach(() => localStorage.clear());
  it("installs all nine screenshot groups on a fresh device", () => {
    expect(loadNameKeywordGroups(localStorage)).toEqual(
      SHARED_NAME_KEYWORD_GROUPS,
    );
    expect(SHARED_NAME_KEYWORD_GROUPS.map((g) => g.includes)).toEqual([
      "90",
      "45",
      "Coupling",
      "Wye",
      "TY, tee",
      "Adapter, adaptor",
      "Reducing",
      "Fitting",
      "Flange",
    ]);
    expect(SHARED_NAME_KEYWORD_GROUPS[1]?.excludes).toBe(
      "Reducing, fitting, fit, flange",
    );
  });
  it("replaces existing rules once, backs them up, and retains later edits", () => {
    const old = JSON.stringify(["Legacy"]);
    localStorage.setItem(NAME_KEYWORDS_KEY, old);
    expect(loadNameKeywordGroups(localStorage)).toEqual(
      SHARED_NAME_KEYWORD_GROUPS,
    );
    expect(
      localStorage.getItem(
        `${NAME_KEYWORDS_KEY}.backup.${NAME_KEYWORDS_ROLLOUT}`,
      ),
    ).toBe(old);
    const edited = [{ includes: "Custom", excludes: "Other" }];
    localStorage.setItem(NAME_KEYWORDS_KEY, JSON.stringify(edited));
    expect(loadNameKeywordGroups(localStorage)).toEqual(edited);
    localStorage.setItem(NAME_KEYWORDS_KEY, "[]");
    expect(loadNameKeywordGroups(localStorage)).toEqual([]);
  });
  it("still provides the shared rules when storage is unavailable", () => {
    expect(
      loadNameKeywordGroups({
        getItem() {
          throw Error("unavailable");
        },
        setItem() {
          throw Error("unavailable");
        },
      }),
    ).toEqual(SHARED_NAME_KEYWORD_GROUPS);
  });
});
