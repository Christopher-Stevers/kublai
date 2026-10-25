import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { STANDARD_DEFAULTS } from "~/lib/permission-catalog";
import { PermissionEditor } from "./PermissionEditor";

afterEach(cleanup);

it("offers the four material list permissions as independent switches", () => {
  function Editor() {
    const [value, setValue] = useState(STANDARD_DEFAULTS);
    return <PermissionEditor value={value} onChange={setValue} />;
  }
  render(<Editor />);
  const section = screen
    .getByRole("heading", { name: "Material lists" })
    .closest("section")!;
  const switches = within(section).getAllByRole("switch");
  expect(switches.map((element) => element.getAttribute("aria-label"))).toEqual(
    [
      "Create material lists",
      "Delete material lists",
      "Make orders",
      "Verify orders",
    ],
  );
  const before = switches.map((element) =>
    element.getAttribute("aria-checked"),
  );
  switches.forEach((element, index) => {
    fireEvent.click(element);
    switches.forEach((other, otherIndex) => {
      expect(other).toHaveAttribute(
        "aria-checked",
        otherIndex === index
          ? String(before[index] !== "true")
          : before[otherIndex]!,
      );
    });
    fireEvent.click(element);
  });
  fireEvent.click(within(section).getByRole("button", { name: /All$/ }));
  switches.forEach((element) =>
    expect(element).toHaveAttribute("aria-checked", "true"),
  );
  fireEvent.click(within(section).getByRole("button", { name: /None$/ }));
  switches.forEach((element) =>
    expect(element).toHaveAttribute("aria-checked", "false"),
  );
  expect(screen.getAllByRole("switch", { name: "Make orders" })).toHaveLength(
    1,
  );
  expect(screen.getAllByRole("switch", { name: "Verify orders" })).toHaveLength(
    1,
  );
});
