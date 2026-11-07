import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DepartmentsSection } from "./DepartmentsSection";
const { save, remove } = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: {
    organization: {
      saveDepartment: {
        useMutation: () => ({ mutate: save, isPending: false, error: null }),
      },
      deleteDepartment: {
        useMutation: () => ({ mutate: remove, isPending: false, error: null }),
      },
    },
  },
}));
vi.mock("~/components/ui/app-dialogs", () => ({
  notify: vi.fn(),
  confirmAction: vi.fn(async () => true),
}));
type Settings = ComponentProps<typeof DepartmentsSection>["settings"];
const fixture = () =>
  ({
    viewer: { canManageMembers: true },
    departments: [
      {
        id: "dept",
        name: "Plumbing",
        revision: 2,
        leadUserIds: ["alice"],
        memberCount: 1,
      },
    ],
    members: [
      {
        id: "alice",
        name: "Alice",
        email: "alice@example.test",
        department: "Plumbing",
      },
      { id: "bob", name: "Bob", email: "bob@example.test", department: null },
    ],
    permissionPresets: [],
  }) as unknown as Settings;
beforeEach(() => {
  save.mockReset();
  remove.mockReset();
});
afterEach(cleanup);
describe("department directory", () => {
  it("creates a department and selects multiple leads", () => {
    render(<DepartmentsSection settings={fixture()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New department" }));
    fireEvent.change(screen.getByLabelText("Department name"), {
      target: { value: "Mechanical" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Alice/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Bob/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save department" }));
    expect(save).toHaveBeenCalledWith({
      id: undefined,
      revision: undefined,
      name: "Mechanical",
      leadUserIds: ["alice", "bob"],
    });
  });
  it("searches leads and saves the revision when editing", () => {
    render(<DepartmentsSection settings={fixture()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search department leads"), {
      target: { value: "Bob" },
    });
    expect(
      screen.queryByRole("checkbox", { name: /Alice/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Bob/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save department" }));
    expect(save).toHaveBeenCalledWith({
      id: "dept",
      revision: 2,
      name: "Plumbing",
      leadUserIds: ["alice", "bob"],
    });
    expect(
      screen.getByRole("button", { name: "Delete department" }),
    ).toBeDisabled();
  });
  it("keeps unsaved changes and the original revision during a refresh", () => {
    const settings = fixture();
    const view = render(
      <DepartmentsSection settings={settings} onSaved={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Department name"), {
      target: { value: "My edit" },
    });
    const updated = structuredClone(settings);
    updated.departments[0]!.name = "Other edit";
    updated.departments[0]!.revision = 3;
    view.rerender(<DepartmentsSection settings={updated} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save department" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 2, name: "My edit" }),
    );
  });
  it("lets viewers see departments without changing them", () => {
    const settings = fixture();
    settings.viewer.canManageMembers = false;
    render(<DepartmentsSection settings={settings} onSaved={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: "New department" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Department name")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Alice/ })).toBeDisabled();
  });
});
