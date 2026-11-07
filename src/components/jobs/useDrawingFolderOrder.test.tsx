import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import {
  recordDrawingFolderOpen,
  recordDrawingSheetOpen,
  useDrawingFolderOrder,
  useDrawingSheetOrder,
} from "./useDrawingFolderOrder";

const folders = [
  { id: "a", name: "Mechanical" },
  { id: "b", name: "Architectural" },
  { id: "c", name: "Electrical" },
];

beforeEach(() => localStorage.clear());

it("puts the most opened folders first and keeps server order for ties", () => {
  const { result } = renderHook(() => useDrawingFolderOrder());
  expect(result.current.order).toBe("used");
  act(() => {
    recordDrawingFolderOpen("c");
    recordDrawingFolderOpen("c");
    recordDrawingFolderOpen("b");
  });
  expect(result.current.sortFolders(folders).map((f) => f.id)).toEqual([
    "c",
    "b",
    "a",
  ]);
});

it("sorts alphabetically and remembers the choice", () => {
  const { result } = renderHook(() => useDrawingFolderOrder());
  act(() => result.current.setOrder("az"));
  expect(result.current.sortFolders(folders).map((f) => f.name)).toEqual([
    "Architectural",
    "Electrical",
    "Mechanical",
  ]);
  expect(renderHook(() => useDrawingFolderOrder()).result.current.order).toBe(
    "az",
  );
});

it("keeps drawings A–Z by default and can put the most opened first", () => {
  const sheets = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
  const { result } = renderHook(() => useDrawingSheetOrder());
  expect(result.current.order).toBe("az");
  act(() => {
    recordDrawingSheetOpen("m3");
    recordDrawingSheetOpen("m2");
    recordDrawingSheetOpen("m3");
  });
  expect(result.current.sortSheets(sheets).map((s) => s.id)).toEqual([
    "m1",
    "m2",
    "m3",
  ]);
  act(() => result.current.setOrder("used"));
  expect(result.current.sortSheets(sheets).map((s) => s.id)).toEqual([
    "m3",
    "m2",
    "m1",
  ]);
  // Drawing opens don't change the folder order.
  expect(renderHook(() => useDrawingFolderOrder()).result.current.order).toBe(
    "used",
  );
});
