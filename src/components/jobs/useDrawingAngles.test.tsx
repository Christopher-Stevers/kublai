import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDrawingAngles } from "./useDrawingAngles";
const identity = vi.hoisted(() => ({
  account: { accountKey: "" } as { accountKey: string } | null,
}));
vi.mock("./DrawingAccountProvider", () => ({
  useDrawingAccount: () => identity.account,
}));
function Picker({ name }: { name: string }) {
  const [unit, setUnit] = useDrawingAngles();
  return (
    <select
      aria-label={name}
      value={unit}
      onChange={(e) => setUnit(e.target.value as "on" | "off")}
    >
      {["off", "on"].map((value) => (
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
  expect(screen.getByLabelText("Measure")).toHaveValue("off");
  fireEvent.change(screen.getByLabelText("Measure"), {
    target: { value: "on" },
  });
  expect(screen.getByLabelText("Pipe")).toHaveValue("on");
  expect(
    localStorage.getItem(
      `foremanhq:drawing-angles:${identity.account!.accountKey}`,
    ),
  ).toBe("on");
  view.unmount();
  render(<Picker name="Another drawing" />);
  expect(screen.getByLabelText("Another drawing")).toHaveValue("on");
});
it("restores a previously saved preference and isolates it from other accounts", () => {
  const first = identity.account!;
  localStorage.setItem(`foremanhq:drawing-angles:${first.accountKey}`, "on");
  const view = render(<Picker name="Drawing" />);
  expect(screen.getByLabelText("Drawing")).toHaveValue("on");
  identity.account = { accountKey: crypto.randomUUID() };
  view.rerender(<Picker name="Drawing" />);
  expect(screen.getByLabelText("Drawing")).toHaveValue("off");
  fireEvent.change(screen.getByLabelText("Drawing"), {
    target: { value: "off" },
  });
  identity.account = first;
  view.rerender(<Picker name="Drawing" />);
  expect(screen.getByLabelText("Drawing")).toHaveValue("on");
});
it("follows angle changes from another tab without applying another user's preference", () => {
  render(<Picker name="Drawing" />);
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: `foremanhq:drawing-angles:${identity.account!.accountKey}`,
        newValue: "on",
      }),
    ),
  );
  expect(screen.getByLabelText("Drawing")).toHaveValue("on");
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "foremanhq:drawing-angles:someone-else",
        newValue: "on",
      }),
    ),
  );
  expect(screen.getByLabelText("Drawing")).toHaveValue("on");
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
    target: { value: "on" },
  });
  expect(screen.getByLabelText("Drawing")).toHaveValue("on");
});
