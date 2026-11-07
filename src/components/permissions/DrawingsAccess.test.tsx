import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawingsAccessGate, DrawingsAccessProvider } from "./DrawingsAccess";
import { JobWorkspaceOptions } from "~/components/jobs/JobWorkspaceOptions";
const state = vi.hoisted(() => ({ allowed: undefined as boolean | undefined }));
vi.mock("~/trpc/react", () => ({
  api: {
    user: {
      getMyRole: {
        useQuery: () => ({
          data:
            state.allowed === undefined
              ? undefined
              : { permissions: { can: { "drawings.view": state.allowed } } },
        }),
      },
    },
  },
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
afterEach(() => {
  cleanup();
  state.allowed = undefined;
});
describe("drawing access", () => {
  it("hides the card and prevents direct drawing content from mounting", () => {
    render(
      <DrawingsAccessProvider initialAllowed={false}>
        <JobWorkspaceOptions onSelect={vi.fn()} />
        <DrawingsAccessGate>
          <p>Private drawing content</p>
        </DrawingsAccessGate>
      </DrawingsAccessProvider>,
    );
    expect(screen.queryByText("Drawings", { exact: true })).toBeNull();
    expect(screen.queryByText("Private drawing content")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "permission to access drawings",
    );
    expect(screen.getByText("Rooms", { exact: true })).toBeInTheDocument();
  });
  it("applies live preset access changes without reloading the job", () => {
    state.allowed = true;
    const view = render(
      <DrawingsAccessProvider initialAllowed={true}>
        <JobWorkspaceOptions onSelect={vi.fn()} />
      </DrawingsAccessProvider>,
    );
    expect(screen.getByText("Drawings", { exact: true })).toBeInTheDocument();
    state.allowed = false;
    view.rerender(
      <DrawingsAccessProvider initialAllowed={true}>
        <JobWorkspaceOptions onSelect={vi.fn()} />
      </DrawingsAccessProvider>,
    );
    expect(screen.queryByText("Drawings", { exact: true })).toBeNull();
  });
});
