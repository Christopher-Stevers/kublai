import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SystemsAccessProvider, SystemsAccessGate } from "./SystemsAccess";
import { JobWorkspaceOptions } from "~/components/jobs/JobWorkspaceOptions";
const state = vi.hoisted(() => ({ allowed: undefined as boolean | undefined }));
// Systems is a Dev feature; these tests are about the access permission.
vi.mock("~/components/app/DevFeaturesProvider", () => ({
  useDevFeatures: () => true,
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/trpc/react", () => ({
  api: {
    user: {
      getMyRole: {
        useQuery: () => ({
          data:
            state.allowed === undefined
              ? undefined
              : { permissions: { can: { "systems.access": state.allowed } } },
        }),
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  state.allowed = undefined;
});
function Content() {
  return (
    <>
      <JobWorkspaceOptions onSelect={vi.fn()} />
      <SystemsAccessGate>
        <p>Systems content</p>
      </SystemsAccessGate>
    </>
  );
}
it("hides Systems and blocks its content while leaving other job cards available", () => {
  render(
    <SystemsAccessProvider initialAllowed={false}>
      <Content />
    </SystemsAccessProvider>,
  );
  expect(screen.queryByRole("button", { name: "Systems" })).toBeNull();
  expect(screen.queryByText("Systems content")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "permission to access Systems",
  );
  expect(screen.getByText("Material Lists")).toBeInTheDocument();
  expect(screen.getByText("Drawings")).toBeInTheDocument();
});
it("uses server access initially and responds to a live revocation", () => {
  const view = render(
    <SystemsAccessProvider initialAllowed={true}>
      <Content />
    </SystemsAccessProvider>,
  );
  expect(screen.getByRole("button", { name: "Systems" })).toBeInTheDocument();
  state.allowed = false;
  view.rerender(
    <SystemsAccessProvider initialAllowed={true}>
      <Content />
    </SystemsAccessProvider>,
  );
  expect(screen.queryByRole("button", { name: "Systems" })).toBeNull();
  expect(screen.queryByText("Systems content")).toBeNull();
});
