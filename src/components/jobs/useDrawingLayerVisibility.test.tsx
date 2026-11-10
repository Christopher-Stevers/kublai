import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useDrawingLayerVisibility } from "./useDrawingLayerVisibility";
afterEach(cleanup);
it("remembers group and child visibility across closing, isolated by drawing and account", () => {
  const account = crypto.randomUUID();
  const first = renderHook(() => useDrawingLayerVisibility(account, "sheet-a"));
  act(() =>
    first.result.current[1]((old) => ({
      ...old,
      measurements: false,
      issues: false,
      hidden: ["arrow"],
    })),
  );
  first.unmount();
  const reopened = renderHook(
    ({ user, sheet }) => useDrawingLayerVisibility(user, sheet),
    { initialProps: { user: account, sheet: "sheet-a" } },
  );
  expect(reopened.result.current[0]).toMatchObject({
    measurements: false,
    issues: false,
    hidden: ["arrow"],
  });
  expect(
    JSON.parse(
      localStorage.getItem(
        `foremanhq:drawing-layers:${JSON.stringify([account, "sheet-a"])}`,
      )!,
    ),
  ).toMatchObject({ measurements: false });
  reopened.rerender({ user: account, sheet: "sheet-b" });
  expect(reopened.result.current[0].issues).toBe(true);
  reopened.rerender({ user: account + "other", sheet: "sheet-a" });
  expect(reopened.result.current[0].hidden).toEqual(["link"]);
});
it("ignores damaged saved settings and keeps unauthenticated settings out of storage", () => {
  const user = crypto.randomUUID();
  localStorage.setItem(
    `foremanhq:drawing-layers:${JSON.stringify([user, "sheet"])}`,
    '{"markups":false}',
  );
  const hook = renderHook(() => useDrawingLayerVisibility(user, "sheet"));
  expect(hook.result.current[0].markups).toBe(true);
  const before = localStorage.length;
  const anonymous = renderHook(() =>
    useDrawingLayerVisibility(undefined, "sheet"),
  );
  act(() => anonymous.result.current[1]((old) => ({ ...old, markups: false })));
  expect(anonymous.result.current[0].markups).toBe(false);
  expect(localStorage.length).toBe(before);
});

it("resets old hyperlink visibility once for every account and sheet, preserving later choices", () => {
  const user = crypto.randomUUID();
  const old = {markups:false, issues:true, private:false, published:true, hidden:["arrow"]};
  for (const sheet of ["a", "b"]) localStorage.setItem(`foremanhq:drawing-layers:${JSON.stringify([user, sheet])}`, JSON.stringify(old));
  const first = renderHook(() => useDrawingLayerVisibility(user, "a"));
  expect(first.result.current[0]).toMatchObject({...old, hidden:["arrow", "link"]});
  act(() => first.result.current[1](value => ({...value, hidden: value.hidden?.filter(type => type !== "link")})));
  first.unmount();
  const reopened = renderHook(() => useDrawingLayerVisibility(user, "a"));
  expect(reopened.result.current[0].hidden).toEqual(["arrow"]);
  expect(renderHook(() => useDrawingLayerVisibility(user, "b")).result.current[0].hidden).toEqual(["arrow", "link"]);
  expect(renderHook(() => useDrawingLayerVisibility(user + "other", "a")).result.current[0].hidden).toEqual(["link"]);
  expect(renderHook(() => useDrawingLayerVisibility(user, "snapshot", old)).result.current[0].hidden).toEqual(["arrow", "link"]);
});
