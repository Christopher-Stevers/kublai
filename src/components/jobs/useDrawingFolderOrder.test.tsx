import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import {
  recordDrawingFolderOpen,
  useDrawingFolderOrder,
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
