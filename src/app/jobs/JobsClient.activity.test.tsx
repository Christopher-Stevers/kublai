import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { setAppPageActive } from "~/lib/app-page-activity";
const state = vi.hoisted(() => ({
  view: "options",
  list: null as string | null,
  editorCleanup: vi.fn(),
}));
function Panel({ label }: { label: string }) {
  const [value, setValue] = useState("");
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}
function Editor() {
  useEffect(() => () => state.editorCleanup(), []);
  return <Panel label="Documents" />;
}
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn() }),
}));
vi.mock("~/hooks/use-job-workspace-navigation", () => ({
  useJobWorkspaceNavigation: () => ({
    location: { jobId: "job", view: state.view, materialListId: state.list },
    navigate: vi.fn(),
    back: vi.fn(),
  }),
}));
vi.mock("~/hooks/use-workspace-mutations", () => ({
  useWorkspaceMutations: () => ({
    getReplicache: vi.fn(),
    mutateAndSync: vi.fn(),
  }),
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => false }));
vi.mock("~/hooks/use-remembered-scroll", () => ({ useScrollToTop: () => {} }));
vi.mock("~/components/tutorial/tutorial-sandbox-context", () => ({
  useTutorialSandbox: () => null,
}));
vi.mock("~/hooks/use-replicache-jobs", () => ({
  useReplicacheJobsList: () => [],
  useReplicacheJobDetail: () => ({
    job: { id: "job", name: "Job" },
    materialLists: [],
  }),
}));
vi.mock("~/hooks/use-job-room-count", () => ({
  useJobRoomCount: () => ({ count: 0, loading: false }),
}));
vi.mock("~/components/jobs/JobOverviewHeading", () => ({
  JobOverviewHeading: () => null,
}));
vi.mock("~/components/jobs/JobWorkspaceOptions", () => ({
  JobWorkspaceOptions: () => <Panel label="Options" />,
}));
vi.mock("~/components/materialLists/JobMaterialListsView", () => ({
  JobMaterialListsView: () => <Panel label="Lists" />,
}));
vi.mock("~/components/models/DeferredJobModelsView", () => ({
  DeferredJobModelsView: () => <Panel label="Models" />,
}));
vi.mock("~/components/app/DeferredFeatures", () => ({
  JobEditDialog: () => null,
  JobChatView: () => <Panel label="Chat" />,
  MaterialListScreen: () => <Panel label="Detail" />,
  JobRoomsView: () => <Panel label="Rooms" />,
  JobDrawingsView: () => <Panel label="Drawings" />,
  JobDocumentsView: Editor,
  JobSystemsView: () => <Panel label="Systems" />,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    chat: { getOverview: { useQuery: () => ({}) } },
    user: {
      getMyRole: {
        useQuery: () => ({
          isFetched: true,
          data: { organizationId: "org", permissions: { can: {} } },
        }),
      },
    },
  },
}));
import { JobsClient } from "./JobsClient";
beforeEach(() => {
  state.view = "options";
  state.list = null;
  state.editorCleanup.mockClear();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  setAppPageActive(true);
});
afterEach(() => {
  cleanup();
  setAppPageActive(true);
});
describe("reviewed local Jobs workspace retention", () => {
  it("retains a grid draft across chat and list-detail branches without rendering unopened panels", () => {
    const ui = render(<JobsClient initialJobs={[]} />);
    expect(screen.queryByLabelText("Drawings")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Options"), {
      target: { value: "options draft" },
    });
    state.view = "chat";
    ui.rerender(<JobsClient initialJobs={[]} />);
    fireEvent.change(screen.getByLabelText("Chat"), {
      target: { value: "chat draft" },
    });
    state.view = "material-lists";
    state.list = "list";
    ui.rerender(<JobsClient initialJobs={[]} />);
    expect(screen.getByRole("textbox", { name: "Detail" })).toBeVisible();
    state.list = null;
    state.view = "chat";
    ui.rerender(<JobsClient initialJobs={[]} />);
    expect(screen.getByRole("textbox", { name: "Chat" })).toHaveValue(
      "chat draft",
    );
    state.view = "options";
    ui.rerender(<JobsClient initialJobs={[]} />);
    expect(screen.getByRole("textbox", { name: "Options" })).toHaveValue(
      "options draft",
    );
    expect(
      ui.container.querySelectorAll("[data-job-panel]").length,
    ).toBeLessThanOrEqual(3);
  });
  it("does not Activity-hide an external document editor or abort its save on internal-window pause", () => {
    const ui = render(<JobsClient initialJobs={[]} />);
    state.view = "documents";
    ui.rerender(<JobsClient initialJobs={[]} />);
    expect(screen.getByLabelText("Documents")).toBeVisible();
    expect(ui.container.querySelector("[data-job-panel]")).toBeNull();
    act(() => setAppPageActive(false));
    expect(state.editorCleanup).not.toHaveBeenCalled();
  });
});
