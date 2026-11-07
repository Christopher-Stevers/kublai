import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PipeSystemPanel } from "./PipeSystemPanel";

afterEach(cleanup);
const props = {
  color: "#2563eb", onColor: vi.fn(), lineWidth: 2, onLineWidth: vi.fn(),
  reading: false, error: null, hasPdf: true, hasLines: true, ready: true,
  codes: ["SAN"], system: "SAN", selectedSystem: "SAN", total: "120 ft", partial: false,
  warnings: [], unit: "ft" as const, scaleSet: true, canSetScale: true,
  onSystem: vi.fn(), onClear: vi.fn(), onRetry: vi.fn(), onScale: vi.fn(), onUnit: vi.fn(),
};

it("offers a material list once a system is selected", () => {
  const onMaterialList = vi.fn();
  const { rerender } = render(<PipeSystemPanel {...props} selected={false} onMaterialList={onMaterialList} />);
  expect(screen.queryByRole("button", { name: "Make material list" })).toBeNull();
  rerender(<PipeSystemPanel {...props} selected onMaterialList={onMaterialList} />);
  fireEvent.click(screen.getByRole("button", { name: "Make material list" }));
  expect(onMaterialList).toHaveBeenCalledOnce();
});
