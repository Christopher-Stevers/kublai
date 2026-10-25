import { act, Suspense } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import JobOptionsPage from "./page";
const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/jobs/alma", useRouter: () => ({ push: mocks.push }) }));
vi.mock("~/trpc/react", () => ({ api: {
  chat: { getOverview: { useQuery: () => ({ data: { unreadCount: 0 } }) } },
  job: { getJob: { useQuery: () => ({ data: { id: "alma", name: "Alma", materialLists: [] }, isFetched: true }) } },
} }));
vi.mock("~/hooks/use-replicache-jobs", () => ({ useReplicacheJobDetail: () => null }));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/hooks/use-job-room-count", () => ({ useJobRoomCount: () => ({ count: 12, loading: false }) }));
vi.mock("~/components/jobs/JobEditDialog", () => ({ JobEditDialog: () => null }));
vi.mock("~/components/jobs/DrawingAccountProvider", () => ({ useDrawingAccount: () => null }));
vi.mock("~/components/permissions/DrawingsAccess", () => ({ useDrawingsAccess: () => true }));
vi.mock("~/lib/job-workspace-last-option", () => ({ setLastJobWorkspaceLocation: vi.fn() }));
afterEach(cleanup);
it("direct job links show only the current shared menu and keep navigation working", async () => {
  const params = Promise.resolve({ jobId: "alma" });
  await act(async () => { render(<Suspense fallback={null}><JobOptionsPage params={params} /></Suspense>); });
  await screen.findByRole("heading", { name: "Alma" });
  expect(screen.queryByRole("button", { name: "Tools" })).toBeNull();
  expect(screen.queryByText("Job pricing & approvals")).toBeNull();
  expect(screen.queryByText("Estimate this job")).toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(8); // Seven cards and Edit job.
  fireEvent.click(screen.getByRole("button", { name: "Rooms, experimental" }));
  expect(mocks.push).toHaveBeenCalledWith("/jobs/alma/rooms");
});
