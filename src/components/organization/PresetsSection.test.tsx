import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSION_PRESETS } from "~/lib/permission-catalog";
import { PresetsSection } from "./PresetsSection";
const { save, remove } = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: {
    organization: {
      savePermissionPreset: {
        useMutation: () => ({ mutate: save, isPending: false, error: null }),
      },
      deletePermissionPreset: {
        useMutation: () => ({ mutate: remove, isPending: false, error: null }),
      },
    },
  },
}));
vi.mock("~/components/ui/app-dialogs", () => ({
  notify: vi.fn(),
  confirmAction: vi.fn(async () => true),
}));
type Settings = ComponentProps<typeof PresetsSection>["settings"];
const journeyman = PERMISSION_PRESETS.find((p) => p.id === "journeyman")!;
function settings(): Settings {
  return {
    viewer: { userId: "actor", canManageMembers: true },
    members: [
      {
        id: "alice",
        name: "Alice",
        permissionPresetId: "preset",
        permissions: { isManagingAccount: false },
      },
      {
        id: "bob",
        name: "Bob",
        permissionPresetId: "preset",
        permissions: { isManagingAccount: false },
      },
    ],
    permissionPresets: [
      {
        id: "preset",
        name: "Journeyman",
        permissions: journeyman.permissions,
        revision: 3,
        memberCount: 2,
      },
    ],
  } as Settings;
}
beforeEach(() => {
  save.mockReset();
  remove.mockReset();
});
afterEach(cleanup);
describe("permission preset editor", () => {
  it("edits a saved preset and clearly shows everyone affected", () => {
    render(<PresetsSection settings={settings()} onSaved={vi.fn()} />);
    expect(
      screen.getByText("2 members will update when you save."),
    ).toBeInTheDocument();
    expect(screen.getByText("Alice, Bob")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete preset" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "Send orders" }));
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
    expect(save).toHaveBeenCalledWith({
      id: "preset",
      name: "Journeyman",
      revision: 3,
      permissions: { ...journeyman.permissions, "orders.send": true },
    });
  });
  it("creates a named preset from a quick template", () => {
    render(<PresetsSection settings={settings()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New preset" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), {
      target: { value: "Journeyman A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Journeyman" }));
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
    expect(save).toHaveBeenCalledWith({
      id: undefined,
      revision: undefined,
      name: "Journeyman A",
      permissions: journeyman.permissions,
    });
  });
  it("keeps unsaved edits and their revision when another manager changes the preset", () => {
    const first = settings();
    const view = render(<PresetsSection settings={first} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch", { name: "Send orders" }));
    const updated = structuredClone(first);
    updated.permissionPresets[0]!.revision = 4;
    updated.permissionPresets[0]!.permissions["parts.create"] = false;
    view.rerender(<PresetsSection settings={updated} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }));
    expect(screen.getByRole("switch", { name: "Send orders" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
  it("locks editing for members without permission to manage people", () => {
    const data = settings();
    data.viewer.canManageMembers = false;
    render(<PresetsSection settings={data} onSaved={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: "New preset" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Preset name" })).toBeDisabled();
    expect(
      screen
        .getAllByRole("switch")
        .every((element) => element.hasAttribute("disabled")),
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Save preset" }),
    ).not.toBeInTheDocument();
  });
});
