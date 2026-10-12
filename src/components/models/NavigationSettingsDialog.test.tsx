import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationSettingsDialog } from "./NavigationSettingsDialog";
import { useNavigationSettings } from "./use-navigation-settings";
import {
  DEFAULT_NAVIGATION,
  navigationPreset,
  navigationSettingsSchema,
  type NavigationSettings,
} from "~/lib/bim/navigation-settings";

let stored: Map<string, string>;
let userId: string;
const onClose = vi.fn();
function Harness({ user = userId }: { user?: string }) {
  const { settings, update, persistent } = useNavigationSettings(user);
  return (
    <>
      <output data-testid="settings">{JSON.stringify(settings)}</output>
      <NavigationSettingsDialog
        settings={settings}
        persistent={persistent}
        onChange={update}
        onClose={onClose}
      />
    </>
  );
}
const settings = () =>
  JSON.parse(screen.getByTestId("settings").textContent) as NavigationSettings;
beforeEach(() => {
  stored = new Map();
  userId = crypto.randomUUID();
  onClose.mockClear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("navigation controls", () => {
  it("persists presets per account and loads them again", () => {
    const { rerender, unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Left-handed/ }));
    expect(settings().keys.forward[0]).toBe("KeyI");
    expect(stored.size).toBe(1);
    rerender(<Harness user="another-account" />);
    expect(settings().keys.forward[0]).toBe("KeyW");
    unmount();
    render(<Harness />);
    expect(settings().keys.forward[0]).toBe("KeyI");
  });
  it("captures a binding, rejects conflicts, clears bindings, and cancels recording with Escape", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Keyboard" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Rebind Move forward primary" }),
    );
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "already assigned to move backward",
    );
    expect(settings().keys.forward[0]).toBe("KeyW");
    fireEvent.keyDown(window, { key: "t", code: "KeyT" });
    expect(settings().keys.forward).toEqual(["KeyT", "ArrowUp"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Rebind Move forward alternate" }),
    );
    fireEvent.keyDown(window, { key: "Backspace", code: "Backspace" });
    expect(settings().keys.forward).toEqual(["KeyT", null]);
    fireEvent.click(
      screen.getByRole("button", { name: "Rebind Move forward primary" }),
    );
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(settings().keys.forward[0]).toBe("KeyT");
    expect(onClose).not.toHaveBeenCalled();
  });
  it("changes mouse controls and resets all customizations", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Mouse" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Right button" }), {
      target: { value: "zoom" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Reverse scroll zoom" }),
    );
    fireEvent.change(screen.getByRole("slider", { name: "Pan sensitivity" }), {
      target: { value: "2.5" },
    });
    expect(settings()).toMatchObject({
      mouse: { right: "zoom" },
      reverseScroll: true,
      panSensitivity: 2.5,
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset defaults" }));
    expect(settings()).toEqual(DEFAULT_NAVIGATION);
  });
  it("recovers from invalid saved preferences and tolerates unavailable storage", () => {
    stored.set(
      `foremanhq:model-navigation:v1:${userId}`,
      JSON.stringify({ ...DEFAULT_NAVIGATION, moveSpeed: 99999 }),
    );
    render(<Harness />);
    expect(settings()).toEqual(DEFAULT_NAVIGATION);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {
        throw Error("blocked");
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Orbit \/ CAD/ }));
    expect(settings().mouse.left).toBe("orbit");
    expect(
      screen.getByText(/Changes apply for this session/),
    ).toBeInTheDocument();
  });
  it("validates all presets and rejects reserved browser keys", () => {
    for (const name of [
      "first-person",
      "cad",
      "trackpad",
      "left-handed",
    ] as const)
      expect(
        navigationSettingsSchema.safeParse(navigationPreset(name)).success,
      ).toBe(true);
    expect(
      navigationSettingsSchema.safeParse({
        ...DEFAULT_NAVIGATION,
        keys: { ...DEFAULT_NAVIGATION.keys, forward: ["Tab", null] },
      }).success,
    ).toBe(false);
  });
});
