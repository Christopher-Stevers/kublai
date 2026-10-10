import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PERMISSION_KEYS,
  STANDARD_DEFAULTS,
  type PermissionMap,
} from "~/lib/permission-catalog";
import { MembersSection } from "./MembersSection";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: {
    organization: {
      updateOrganizationMember: {
        useMutation: () => ({ mutate, isPending: false, error: null }),
      },
    },
  },
}));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: vi.fn() }));

type Settings = ComponentProps<typeof MembersSection>["settings"];

function settingsFor(kind: "executive" | "admin" | "standard"): Settings {
  const isAdmin = kind === "admin";
  const isManagingAccount = kind !== "standard";
  const can = isManagingAccount
    ? (Object.fromEntries(
        PERMISSION_KEYS.map((key) => [key, true]),
      ) as PermissionMap)
    : { ...STANDARD_DEFAULTS };
  // Only the fields read by MembersSection are needed for the component fixture.
  return {
    viewer: { userId: "viewer", canManageMembers: true },
    members: [
      {
        id: "member",
        name: "Pat Example",
        email: "pat@example.test",
        createdAt: new Date("2026-10-01T12:00:00Z"),
        organizationAccessStatus: "approved",
        permissions: {
          isAdmin,
          isManagingAccount,
          accountTypeLabel: isAdmin
            ? "Admin"
            : isManagingAccount
              ? "Executive Account"
              : "Standard Account",
          can,
        },
      },
    ],
  } as Settings;
}

beforeEach(() => mutate.mockReset());
afterEach(cleanup);

describe("protected member controls", () => {
  it.each(["executive", "admin"] as const)(
    "locks every permission control and access status for an %s account",
    (kind) => {
      render(<MembersSection settings={settingsFor(kind)} onSaved={vi.fn()} />);

      for (const permission of screen.getAllByRole("switch")) {
        expect(permission).toBeDisabled();
        expect(permission).toHaveAttribute("aria-checked", "true");
        fireEvent.click(permission);
        expect(permission).toHaveAttribute("aria-checked", "true");
      }
      for (const status of screen.getAllByRole("radio")) {
        expect(status).toBeDisabled();
        fireEvent.click(status);
      }
      expect(screen.getByRole("radio", { name: "Active" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      const viewOnly = screen.getByRole("button", { name: "View only" });
      expect(viewOnly).toBeDisabled();
      fireEvent.click(viewOnly);
      for (const group of screen.getAllByRole("button", {
        name: /· (None|All)$/,
      })) {
        expect(group).toBeDisabled();
        fireEvent.click(group);
      }
      expect(
        screen.queryByRole("button", { name: "Save changes" }),
      ).not.toBeInTheDocument();
      expect(mutate).not.toHaveBeenCalled();
    },
  );

  it("keeps Executive permissions locked while allowing a pending invitation to be approved", () => {
    const settings = settingsFor("executive");
    settings.members[0]!.organizationAccessStatus = "pending";
    render(<MembersSection settings={settings} onSaved={vi.fn()} />);
    for (const permission of screen.getAllByRole("switch")) {
      expect(permission).toBeDisabled();
    }
    expect(screen.getByRole("radio", { name: "Waiting" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Active" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mutate).toHaveBeenCalledWith({
      userId: "member",
      accessStatus: "approved",
      permissions: settings.members[0]!.permissions.can,
    });
  });

  it("still allows a Standard member permission and access status to be edited", () => {
    render(
      <MembersSection settings={settingsFor("standard")} onSaved={vi.fn()} />,
    );
    const organization = screen.getByRole("switch", { name: "Organization" });
    expect(organization).not.toBeDisabled();
    expect(organization).toHaveAttribute("aria-checked", "false");
    fireEvent.click(organization);
    fireEvent.click(screen.getByRole("radio", { name: "Blocked" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mutate).toHaveBeenCalledWith({
      userId: "member",
      accessStatus: "denied",
      permissions: { ...STANDARD_DEFAULTS, "tab.organization": true },
      permissionPresetId: null,
    });
  });

  it("finds Executive members by their account type", () => {
    render(
      <MembersSection settings={settingsFor("executive")} onSaved={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search members" }), {
      target: { value: "Executive" },
    });
    expect(
      screen.getByRole("button", { name: /Pat Example.*Executive Account/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No members match.")).not.toBeInTheDocument();
  });
});

describe("Executive employee simulation controls", () => {
  it("shows simulation at the bottom of an active standard employee detail", () => {
    const settings = settingsFor("standard");
    settings.viewer.canSimulateEmployees = true;
    render(<MembersSection settings={settings} onSaved={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Simulate employee" }),
    ).toBeEnabled();
    expect(screen.getByText("Simulation audit trail")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    expect(
      screen.getByRole("button", { name: "Simulate employee" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Save permission changes before starting simulation."),
    ).toBeInTheDocument();
  });
  it("hides simulation from standard viewers and for protected accounts", () => {
    const settings = settingsFor("standard");
    settings.viewer.canSimulateEmployees = false;
    const view = render(
      <MembersSection settings={settings} onSaved={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: "Simulate employee" }),
    ).not.toBeInTheDocument();
    const protectedSettings = settingsFor("admin");
    protectedSettings.viewer.canSimulateEmployees = true;
    view.rerender(
      <MembersSection settings={protectedSettings} onSaved={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: "Simulate employee" }),
    ).not.toBeInTheDocument();
  });
  it("disables simulation until employee organization access is active", () => {
    const settings = settingsFor("standard");
    settings.viewer.canSimulateEmployees = true;
    settings.members[0]!.organizationAccessStatus = "pending";
    render(<MembersSection settings={settings} onSaved={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Simulate employee" }),
    ).toBeDisabled();
  });
});

describe("live member presets", () => {
  const presetId = "00000000-0000-4000-8000-000000000001";
  function liveSettings() {
    const settings = settingsFor("standard");
    settings.permissionPresets = [
      {
        id: presetId,
        name: "Journeyman",
        revision: 1,
        permissions: { ...STANDARD_DEFAULTS, "orders.send": false },
        memberCount: 1,
      },
    ];
    return settings;
  }
  it("assigns a live reference and locks individual switches", () => {
    render(<MembersSection settings={liveSettings()} onSaved={vi.fn()} />);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Permission preset" }),
      { target: { value: presetId } },
    );
    expect(screen.getByRole("switch", { name: "Send orders" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionPresetId: presetId,
        userId: "member",
      }),
    );
  });
  it("allows detaching while keeping the current permissions", () => {
    const settings = liveSettings();
    settings.members[0]!.permissionPresetId = presetId;
    render(<MembersSection settings={settings} onSaved={vi.fn()} />);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Permission preset" }),
      { target: { value: "" } },
    );
    expect(screen.getByRole("switch", { name: "Send orders" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionPresetId: null,
        permissions: settings.permissionPresets[0]!.permissions,
      }),
    );
  });
  it("shows new live permissions when the organization data refreshes", () => {
    const settings = liveSettings();
    settings.members[0]!.permissionPresetId = presetId;
    const view = render(
      <MembersSection settings={settings} onSaved={vi.fn()} />,
    );
    expect(screen.getByRole("switch", { name: "Send orders" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    const updated = structuredClone(settings);
    updated.permissionPresets[0]!.permissions["orders.send"] = true;
    updated.members[0]!.permissions.can["orders.send"] = true;
    view.rerender(<MembersSection settings={updated} onSaved={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Send orders" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Send orders" })).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });
});
