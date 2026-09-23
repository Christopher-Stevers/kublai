import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MaterialStage, type MaterialStageProps } from "./MaterialStage";
afterEach(cleanup);
function props(): MaterialStageProps {
  return {
    materials: [
      { id: "xfr", name: "XFR", groupPath: ["PVC"], count: 8 },
      { id: "dwv", name: "PVC DWV", groupPath: ["PVC"], count: 4 },
      {
        id: "dr25",
        name: "Gasketed DR25",
        groupPath: ["PVC", "Gasketed SDR"],
        count: 5,
      },
      {
        id: "dr35",
        name: "Gasketed DR35",
        groupPath: ["PVC", "Gasketed SDR"],
        count: 7,
      },
      { id: "cu", name: "Copper", count: 10 },
    ],
    selectedMaterialId: null,
    onMaterialSelect: vi.fn(),
    showCustomMaterialInput: false,
    onShowCustomMaterialInput: vi.fn(),
    customMaterialName: "",
    onCustomMaterialNameChange: vi.fn(),
    onCreateMaterial: { mutate: vi.fn(), isPending: false },
    isOnline: false,
  };
}
it("browses PVC and gasketed subgroups offline without selecting a material prematurely", () => {
  const input = props();
  render(<MaterialStage {...input} />);
  expect(screen.queryByText("XFR")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /PVC 4 material types/ }));
  expect(input.onMaterialSelect).not.toHaveBeenCalled();
  expect(screen.getByText("XFR")).toBeInTheDocument();
  expect(screen.queryByText("Copper")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /Gasketed SDR 2 material types/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Gasketed DR35/ }));
  expect(input.onMaterialSelect).toHaveBeenCalledWith("dr35");
});
it("returns to parent groups using breadcrumbs", () => {
  render(<MaterialStage {...props()} selectedMaterialId="dr35" />);
  expect(screen.getByText("Select Gasketed SDR type")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^PVC$/ }));
  expect(screen.getByText("XFR")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^All materials$/ }));
  expect(screen.getByText("Copper")).toBeInTheDocument();
  expect(screen.queryByText("XFR")).not.toBeInTheDocument();
});
it("leaves ungrouped selection and the All option intact", () => {
  const input = props();
  render(<MaterialStage {...input} />);
  fireEvent.click(screen.getByRole("button", { name: /Copper/ }));
  expect(input.onMaterialSelect).toHaveBeenCalledWith("cu");
  fireEvent.click(screen.getByText("All", { exact: true }));
  expect(input.onMaterialSelect).toHaveBeenLastCalledWith(null);
});
