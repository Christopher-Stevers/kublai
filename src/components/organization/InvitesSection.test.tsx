import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERMISSION_PRESETS } from "~/lib/permission-catalog";

const create = vi.hoisted(() => vi.fn());
vi.mock("~/trpc/react", () => ({
  api: {
    organization: {
      createOrganizationInvite: { useMutation: () => ({ mutate: create, isPending: false, error: null }) },
      revokeOrganizationInvite: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock("~/components/ui/app-dialogs", () => ({ confirmAction: vi.fn() }));

import { InvitesSection } from "./InvitesSection";

const settings = { viewer: { canInvite: true }, invites: [] } as never;
afterEach(() => {
  cleanup();
  create.mockReset();
});
const startsAs = () => within(screen.getByRole("radiogroup", { name: "Starts as" }));
const preset = (id: string) => PERMISSION_PRESETS.find((p) => p.id === id)!.permissions;

describe("new invite permissions", () => {
  it("has one preset row with Custom, the permission list right under it, and no Quick setup", () => {
    render(<InvitesSection settings={settings} onSaved={async () => undefined} />);
    expect(startsAs().getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Manager", "Foreman", "Journeyman", "Tool room", "View only", "Custom",
    ]);
    expect(startsAs().getByRole("radio", { name: "Journeyman" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/Quick setup/i)).toBeNull();
    expect(screen.queryByText(/Customize permissions/)).toBeNull();
    // The list is always visible and reflects the preset.
    expect(screen.getByRole("switch", { name: "Orders" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Catalogue" })).toHaveAttribute("aria-checked", "false");
  });

  it("switches to Custom when a permission is changed, and back when a preset is picked", () => {
    render(<InvitesSection settings={settings} onSaved={async () => undefined} />);
    fireEvent.click(screen.getByRole("switch", { name: "Catalogue" }));
    expect(startsAs().getByRole("radio", { name: "Custom" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(startsAs().getByRole("radio", { name: "Foreman" }));
    expect(startsAs().getByRole("radio", { name: "Foreman" })).toHaveAttribute("aria-checked", "true");

    fireEvent.change(screen.getByLabelText("Invite name"), { target: { value: "Leads" } });
    fireEvent.click(screen.getByRole("button", { name: /Create QR invite/ }));
    expect(create).toHaveBeenCalledWith({ name: "Leads", permissions: preset("foreman"), expiresInDays: 7 });
  });

  it("keeps the current permissions when Custom is picked directly", () => {
    render(<InvitesSection settings={settings} onSaved={async () => undefined} />);
    fireEvent.click(startsAs().getByRole("radio", { name: "Custom" }));
    expect(startsAs().getByRole("radio", { name: "Custom" })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByLabelText("Invite name"), { target: { value: "Crew" } });
    fireEvent.click(screen.getByRole("button", { name: /Create QR invite/ }));
    expect(create).toHaveBeenCalledWith({ name: "Crew", permissions: preset("journeyman"), expiresInDays: 7 });
  });
});
