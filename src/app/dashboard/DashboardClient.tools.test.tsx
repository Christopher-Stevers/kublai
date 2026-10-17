import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  send: vi.fn(),
  fetch: vi.fn(),
  kind: "tools",
  itemMode: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock("~/hooks/use-job-workspace-navigation", () => ({
  useJobWorkspaceNavigation: () => ({
    location: { jobId: "job", view: "material-lists", materialListId: "list" },
    navigate: vi.fn(),
    back: vi.fn(),
  }),
}));
vi.mock("~/hooks/use-workspace-mutations", () => ({
  useWorkspaceMutations: () => ({ requestSync: vi.fn() }),
}));
vi.mock("~/hooks/use-replicache-jobs", () => ({
  useReplicacheJobsList: () => [],
  useReplicacheJobDetail: () => ({
    job: { id: "job", name: "Job" },
    materialLists: [],
  }),
}));
vi.mock("~/hooks/use-replicache-material-list", () => ({
  useReplicacheMaterialList: () => ({
    materialList: { id: "list", name: "Tool request", kind: state.kind },
    items: [{ id: "item", quantity: "2" }],
    materialTotal: 0,
  }),
}));
vi.mock("~/hooks/use-replicache-suppliers", () => ({
  useReplicacheSuppliers: () => [],
}));
vi.mock("~/hooks/use-material-list-sort", () => ({
  useMaterialListSort: (items: unknown[]) => ({ sortedItems: items }),
}));
vi.mock("~/hooks/use-job-room-count", () => ({ useJobRoomCount: () => 0 }));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/hooks/use-page-view-state", async () => {
  const { useState } = await import("react");
  return {
    usePageViewState: (_key: string, value: unknown) => useState(value),
  };
});
vi.mock("~/components/tutorial/tutorial-sandbox-context", () => ({
  useTutorialSandbox: () => null,
}));
vi.mock("~/components/materialLists/use-card-merge", () => ({
  useCardMerge: () => ({ isPending: false }),
}));
vi.mock("~/components/permissions/FinancialVisibility", () => ({
  FinancialOnly: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/components/materialLists/MaterialListItem", () => ({
  MaterialListItem: (props: { isToolRequest?: boolean }) => {
    state.itemMode(props.isToolRequest);
    return <div>Drill</div>;
  },
}));
vi.mock("~/components/materialLists/MaterialListSheet", () => ({
  MaterialListSheet: () => null,
}));
vi.mock("~/components/materialLists/VerifyOrderButton", () => ({
  MaterialListOrderPickerDialog: () => null,
}));
vi.mock("~/components/materialLists/MaterialListNameModal", () => ({
  MaterialListNameModal: () => null,
}));
vi.mock("~/components/jobs/JobEditDialog", () => ({
  JobEditDialog: () => null,
}));
vi.mock("~/components/models/DeferredJobModelsView", () => ({
  DeferredJobModelsView: () => null,
}));
vi.mock("~/components/materialLists/prefabs/SaveAsPrefabDialog", () => ({
  SaveAsPrefabDialog: () => null,
}));
vi.mock("~/components/materialLists/UndoOrderButton", () => ({
  UndoOrderButton: () => null,
}));
vi.mock("~/components/materialLists/OrderEmailSkuOption", () => ({
  OrderEmailSkuOption: () => null,
}));
vi.mock("~/components/app/DeferredFeatures", async () => ({
  OrdersPreviewSheet: (
    await import("~/components/materialLists/OrdersPreviewSheet")
  ).OrdersPreviewSheet,
  AddPartDialog: () => null,
  QuotePreviewSheet: () => null,
  ExistingQuotesOrdersDialog: () => null,
  JobRoomsView: () => null,
  JobDrawingsView: () => null,
  JobDocumentsView: () => null,
  JobChatView: () => null,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      materialList: {
        previewOrders: { fetch: state.fetch, invalidate: vi.fn() },
        getOrdersForMaterialList: { invalidate: vi.fn() },
        listOrders: { invalidate: vi.fn() },
      },
      assets: { listRequests: { invalidate: vi.fn() } },
    }),
    user: {
      getMyRole: {
        useQuery: () => ({
          isFetched: true,
          data: {
            organizationId: "org",
            permissions: {
              can: { "orders.send": false, "quotes.create": false },
            },
          },
        }),
      },
    },
    chat: { getOverview: { useQuery: () => ({}) } },
    materialList: {
      duplicate: { useMutation: () => ({ isPending: false }) },
      sendGeneratedOrder: { useMutation: () => ({ mutateAsync: state.send }) },
    },
    jobPricing: { requestApproval: { useMutation: () => ({}) } },
  },
}));

import { DashboardClient } from "./DashboardClient";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("lets a foreman send tools from the job workspace to Asset Management without purchasing permissions", async () => {
  state.kind = "tools";
  const request = {
    id: "possible-tools",
    supplierId: "tool-room",
    items: [{ id: "item", descriptionSnapshot: "Drill", quantity: "2" }],
    supplier: { id: "tool-room", name: "Tool Room", contactEmail: null },
  };
  state.fetch
    .mockResolvedValueOnce({ possible: [request], sent: [], listKind: "tools" })
    .mockResolvedValue({
      possible: [],
      sent: [
        {
          ...request,
          id: "request-id",
          orderNumber: "TOOLS-001",
          fulfillmentStatus: "open",
        },
      ],
      listKind: "tools",
    });
  state.send.mockResolvedValue({ id: "request-id" });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  render(<DashboardClient initialJobs={[]} />);
  expect(state.itemMode).toHaveBeenCalledWith(true);
  const start = screen.getByRole("button", { name: /^Order$/ });
  expect(start).toBeEnabled();
  expect(screen.getByRole("button", { name: "More" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Add Part" })).toBeVisible();
  fireEvent.click(start);
  fireEvent.click(await screen.findByRole("button", { name: /^Send$/ }));
  await waitFor(() =>
    expect(state.send).toHaveBeenCalledWith({
      materialListId: "list",
      supplierId: "tool-room",
      sentTo: "Tool room",
      notes: undefined,
    }),
  );
  expect(
    await screen.findByRole("link", { name: "Waiting on tool room" }),
  ).toHaveAttribute("href", "/dashboard/assets/requests/request-id");
});
