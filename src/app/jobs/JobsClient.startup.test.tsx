import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ online: true, prefetch: vi.fn(), navigate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: state.prefetch }) }));
vi.mock("~/hooks/use-job-workspace-navigation", () => ({ useJobWorkspaceNavigation: () => ({ location: null, navigate: state.navigate, back: vi.fn() }) }));
vi.mock("~/hooks/use-workspace-mutations", () => ({ useWorkspaceMutations: () => ({ getReplicache: vi.fn(), mutateAndSync: vi.fn() }) }));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => state.online, getBrowserOnlineStatus: () => state.online }));
vi.mock("~/hooks/use-remembered-scroll", () => ({ useScrollToTop: () => {} }));
vi.mock("~/components/tutorial/tutorial-sandbox-context", () => ({ useTutorialSandbox: () => null }));
vi.mock("~/hooks/use-replicache-jobs", () => ({ useReplicacheJobsList: () => [], useReplicacheJobDetail: () => ({ job: null, materialLists: [] }) }));
vi.mock("~/hooks/use-job-room-count", () => ({ useJobRoomCount: () => ({ count: 0, loading: false }) }));
vi.mock("~/components/jobs/JobOverviewHeading", () => ({ JobOverviewHeading: () => null }));
vi.mock("~/components/jobs/JobWorkspaceOptions", () => ({ JobWorkspaceOptions: () => null }));
vi.mock("~/components/materialLists/JobMaterialListsView", () => ({ JobMaterialListsView: () => null }));
vi.mock("~/components/models/DeferredJobModelsView", () => ({ DeferredJobModelsView: () => null }));
vi.mock("~/components/app/DeferredFeatures", () => ({
  JobEditDialog: () => null, JobChatView: () => null, MaterialListScreen: () => null,
  JobRoomsView: () => null, JobDrawingsView: () => null, JobDocumentsView: () => null, JobSystemsView: () => null,
}));
vi.mock("~/trpc/react", () => ({ api: {
  chat: { getOverview: { _def: () => ({ path: ["chat", "getOverview"] }), useQuery: () => ({}) } },
  user: { getMyRole: { useQuery: () => ({ isFetched: true, data: { organizationId: "org", permissions: { can: { "jobs.delete": false } } } }) } },
} }));
import { JobsClient, type JobsJob } from "./JobsClient";
let client: QueryClient;
afterEach(() => { cleanup(); client.clear(); state.online = true; vi.clearAllMocks(); });

it("opens a job from the saved workspace after going offline without downloading every job route first", () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const jobs: JobsJob[] = Array.from({ length: 50 }, (_, index) => ({
    id: `job-${index}`, name: `Job ${index}`, poNumber: null, locationId: null,
    foremanName: null, status: "draft", createdAt: "2026-11-12T12:00:00Z",
    location: null, foreman: null, materialListCount: 1,
  }));
  const ui = () => <QueryClientProvider client={client}><JobsClient initialJobs={jobs} /></QueryClientProvider>;
  const view = render(ui());
  expect(screen.getByText("Job 49")).toBeVisible();
  expect(state.prefetch).not.toHaveBeenCalled();
  state.online = false;
  view.rerender(ui());
  fireEvent.click(screen.getByText("Job 49"));
  expect(state.navigate).toHaveBeenCalledWith({ jobId: "job-49", view: "options", materialListId: null });
});
