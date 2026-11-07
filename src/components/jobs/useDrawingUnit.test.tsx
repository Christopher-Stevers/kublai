import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDrawingUnit } from "./useDrawingUnit";
const identity = vi.hoisted(() => ({
  account: { accountKey: "" } as { accountKey: string } | null,
}));
vi.mock("./DrawingAccountProvider", () => ({
  useDrawingAccount: () => identity.account,
}));
function Picker({ name }: { name: string }) {
  const [unit, setUnit] = useDrawingUnit();
  return (
    <select
      aria-label={name}
      value={unit}
      onChange={(e) => setUnit(e.target.value as "mm")}
    >
      {["ft", "m", "mm", "in"].map((value) => (
        <option key={value}>{value}</option>
      ))}
    </select>
  );
}
beforeEach(() => {
  identity.account = { accountKey: crypto.randomUUID() };
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("keeps every open drawing in sync and restores the personal choice when another drawing opens", () => {
  const view = render(
    <>
      <Picker name="Measure" />
      <Picker name="Pipe" />
    </>,
  );
  fireEvent.change(screen.getByLabelText("Measure"), {
    target: { value: "mm" },
  });
  expect(screen.getByLabelText("Pipe")).toHaveValue("mm");
  expect(
    localStorage.getItem(
      `foremanhq:drawing-unit:${identity.account!.accountKey}`,
    ),
  ).toBe("mm");
  view.unmount();
  render(<Picker name="Another drawing" />);
  expect(screen.getByLabelText("Another drawing")).toHaveValue("mm");
});
it("restores a previously saved preference and isolates it from other accounts", () => {
  const first = identity.account!;
  localStorage.setItem(`foremanhq:drawing-unit:${first.accountKey}`, "in");
  const view = render(<Picker name="Drawing" />);
  expect(screen.getByLabelText("Drawing")).toHaveValue("in");
  identity.account = { accountKey: crypto.randomUUID() };
  view.rerender(<Picker name="Drawing" />);
  expect(screen.getByLabelText("Drawing")).toHaveValue("ft");
  fireEvent.change(screen.getByLabelText("Drawing"), {
    target: { value: "m" },
  });
  identity.account = first;
  view.rerender(<Picker name="Drawing" />);
  expect(screen.getByLabelText("Drawing")).toHaveValue("in");
});
it("follows unit changes from another tab without applying another user's preference", () => {
  render(<Picker name="Drawing" />);
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: `foremanhq:drawing-unit:${identity.account!.accountKey}`,
        newValue: "mm",
      }),
    ),
  );
  expect(screen.getByLabelText("Drawing")).toHaveValue("mm");
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "foremanhq:drawing-unit:someone-else",
        newValue: "in",
      }),
    ),
  );
  expect(screen.getByLabelText("Drawing")).toHaveValue("mm");
});
it("keeps working if the device refuses preference storage", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  });
  render(<Picker name="Drawing" />);
  fireEvent.change(screen.getByLabelText("Drawing"), {
    target: { value: "mm" },
  });
  expect(screen.getByLabelText("Drawing")).toHaveValue("mm");
});
