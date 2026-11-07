import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDrawingMarkupVisibility } from "./useDrawingMarkupVisibility";

const identity = vi.hoisted(() => ({ account: { accountKey: "" } }));
vi.mock("./DrawingAccountProvider", () => ({
  useDrawingAccount: () => identity.account,
}));
function Picker({ name = "Default" }: { name?: string }) {
  const [visibility, setVisibility] = useDrawingMarkupVisibility();
  return (
    <select
      aria-label={name}
      value={visibility}
      onChange={(event) => setVisibility(event.target.value as "private")}
    >
      <option value="published">Public</option>
      <option value="private">Private</option>
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

it("restores Private before use and keeps each account's choice across drawings", () => {
  const first = identity.account;
  const key = `foremanhq:drawing-markup-visibility:${first.accountKey}`;
  localStorage.setItem(key, "private");
  const view = render(<Picker />);
  expect(screen.getByLabelText("Default")).toHaveValue("private");
  identity.account = { accountKey: crypto.randomUUID() };
  view.rerender(<Picker />);
  expect(screen.getByLabelText("Default")).toHaveValue("published");
  identity.account = first;
  view.rerender(<Picker />);
  expect(screen.getByLabelText("Default")).toHaveValue("private");
  view.unmount();
  render(<Picker name="Another drawing" />);
  expect(screen.getByLabelText("Another drawing")).toHaveValue("private");
});

it("saves the choice and synchronizes open drawings and other tabs for that account", async () => {
  render(
    <>
      <Picker />
      <Picker name="Another drawing" />
    </>,
  );
  fireEvent.change(screen.getByLabelText("Default"), {
    target: { value: "private" },
  });
  const key = `foremanhq:drawing-markup-visibility:${identity.account.accountKey}`;
  expect(localStorage.getItem(key)).toBe("private");
  expect(screen.getByLabelText("Another drawing")).toHaveValue("private");
  await act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key, newValue: "published" }),
    ),
  );
  expect(screen.getByLabelText("Default")).toHaveValue("published");
  await act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "foremanhq:drawing-markup-visibility:someone-else",
        newValue: "private",
      }),
    ),
  );
  expect(screen.getByLabelText("Default")).toHaveValue("published");
});

it("rejects invalid saved visibility and keeps a Private choice when storage is blocked", () => {
  localStorage.setItem(
    `foremanhq:drawing-markup-visibility:${identity.account.accountKey}`,
    "archived",
  );
  render(<Picker />);
  expect(screen.getByLabelText("Default")).toHaveValue("published");
  vi.stubGlobal("localStorage", {
    setItem: () => {
      throw Error("blocked");
    },
  });
  fireEvent.change(screen.getByLabelText("Default"), {
    target: { value: "private" },
  });
  expect(screen.getByLabelText("Default")).toHaveValue("private");
});
