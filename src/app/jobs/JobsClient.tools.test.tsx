import { MaterialListScreen as ActualMaterialListScreen } from "~/components/materialLists/MaterialListScreen";
import {
  act,
  cleanup,
  fireEvent,
  render as renderComponent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const queryClients: QueryClient[] = [];
function render(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(client);
  return renderComponent(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}

const state = vi.hoisted(() => ({
  overviewLoad: vi.fn(async () => ({ unreadCount: 0 })),
  view: "material-lists",
  online: true,
  send: vi.fn(),
  fetch: vi.fn(),
  kind: "tools",
  itemMode: vi.fn(),
  quotedStatus: vi.fn(),
  materialListId: "list" as string | null,
  items: null as null | Array<Record<string, unknown>>,
  can: { "orders.send": false, "quotes.create": false, "lists.edit": true } as Record<string, boolean>,
  priceBook: undefined as undefined | { policy: { active: boolean }; entries: Array<{id: string; partDefinitionId: string; supplierId: string; supplierPartId: string; supplierSku: null; unitCost: string; priceStatus: string}> },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/jobs",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("~/hooks/use-job-workspace-navigation", () => ({
  useJobWorkspaceNavigation: () => ({
    location: { jobId: "job", view: state.view, materialListId: state.materialListId },
    navigate: vi.fn(),
    back: vi.fn(),
  }),
}));
vi.mock("~/hooks/use-workspace-mutations", () => ({
  useWorkspaceMutations: () => ({ requestSync: vi.fn() }),
}));
vi.mock("~/hooks/use-replicache-jobs", () => ({
  useReplicacheJobsList: () => [],
  useReplicacheJob: () => ({ id: "job", name: "Job" }),
  useReplicacheJobDetail: () => ({
    job: { id: "job", name: "Job" },
    materialLists: [],
  }),
}));
vi.mock("~/hooks/use-replicache-material-list", () => ({
  useReplicacheMaterialList: () => ({
    materialList: { id: "list", name: "Tool request", kind: state.kind },
    items: state.items ?? [{ id: "item", quantity: "2", partDefinition: { id: "part" }, supplierId: "supplier" }],
    materialTotal: 0,
  }),
  useReplicacheSyncing: () => false,
}));
vi.mock("~/components/materialLists/use-slip-draft", () => ({
  useSlipDrafts: () => ({ drafts: [], find: () => null, reload: vi.fn(), choose: vi.fn() }),
}));
vi.mock("~/hooks/use-replicache-suppliers", () => ({
  useReplicacheSuppliers: () => [],
}));
vi.mock("~/hooks/use-material-list-sort", () => ({
  useMaterialListSort: (items: unknown[]) => ({ sortedItems: items }),
}));
vi.mock("~/hooks/use-job-room-count", () => ({ useJobRoomCount: () => 0 }));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => state.online,
  getBrowserOnlineStatus: () => state.online,
}));
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
  MaterialListItem: (props: { isToolRequest?: boolean; item: { jobPriceStatus?: string } }) => {
    state.itemMode(props.isToolRequest);
    state.quotedStatus(props.item.jobPriceStatus);
    return <div>Drill</div>;
  },
}));
vi.mock("~/components/materialLists/JobInfoModal", () => ({
  JobInfoModal: () => null,
}));
vi.mock("~/components/materialLists/MaterialListSheet", () => ({
  MaterialListSheet: () => null,
}));
vi.mock("~/components/materialLists/ScanSlipButton", () => ({
  ScanSlipButton: () => <button>Receive</button>,
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
  MaterialListScreen: (props: React.ComponentProps<typeof ActualMaterialListScreen>) => <ActualMaterialListScreen {...props} />,
  JobEditDialog: () => null,
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
vi.mock("~/components/jobs/JobWorkspaceOptions", () => ({
  JobWorkspaceOptions: ({ chatUnreadCount = 0 }: { chatUnreadCount?: number }) => (
    <output aria-label="Job chat unread">{chatUnreadCount}</output>
  ),
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  function useOverviewQuery(input: { jobId: string }, options: object) {
    return useQuery({
      queryKey: [["chat", "getOverview"], { input, type: "query" }],
      queryFn: state.overviewLoad,
      ...options,
    });
  }
  return {
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
                can: state.can,
              },
            },
          }),
        },
      },
      chat: {
        getOverview: {
          _def: () => ({ path: ["chat", "getOverview"] }),
          useQuery: useOverviewQuery,
        },
      },
      materialList: {
        duplicate: { useMutation: () => ({ isPending: false }) },
        getOrderById: { _def: () => ({ path: ["materialList", "getOrderById"] }), useQuery: () => ({}) },
        updateOrderNotes: { useMutation: () => ({}) },
        updateOrderItemVerification: { useMutation: () => ({}) },
        markAllOrderItemsReceived: { useMutation: () => ({}) },
        sendGeneratedOrder: { useMutation: () => ({ mutateAsync: state.send }) },
      },
      jobPricing: { get: { useQuery: () => ({data: state.priceBook}) }, requestApproval: { useMutation: () => ({}) } },
    },
  };
});

import { setAppPageActive } from "~/lib/app-page-activity";
import { JobsClient } from "./JobsClient";
afterEach(() => {
  cleanup();
  for (const client of queryClients.splice(0)) client.clear();
  state.items = null;
  state.view = "material-lists";
  state.online = true;
  state.materialListId = "list";
  setAppPageActive(true);
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
  render(<JobsClient initialJobs={[]} />);
  expect(state.itemMode).toHaveBeenCalledWith(true);
  const start = screen.getByRole("button", { name: /^Request tools$/ });
  expect(start).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Order" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add Part" })).toBeVisible();
  fireEvent.click(start);
  fireEvent.click(await screen.findByRole("button", { name: /^Send$/ }));
  await waitFor(() =>
    expect(state.send).toHaveBeenCalledWith({
      materialListId: "list",
      supplierId: "tool-room",
      sentTo: "Tool room",
      notes: undefined,
      orderedItemIds: ["item"],
    }),
  );
  expect(
    await screen.findByRole("link", { name: "Waiting on tool room" }),
  ).toHaveAttribute("href", "/jobs/assets/requests/request-id");
});

it("passes the current job's quoted status into dashboard material cards", () => {
  state.kind = "materials";
  state.priceBook = { policy: { active: true }, entries: [{ id: "entry", partDefinitionId: "part", supplierId: "supplier", supplierPartId: "listing", supplierSku: null, unitCost: "10", priceStatus: "confirmed" }] };
  render(<JobsClient initialJobs={[]} />);
  expect(state.quotedStatus).toHaveBeenLastCalledWith("confirmed");
});

it("offers Receive beside New List on the job's material lists for members who receive orders", () => {
  state.materialListId = null;
  state.can = { "orders.receive": true, "lists.edit": true };
  render(<JobsClient initialJobs={[]} />);
  expect(screen.getAllByRole("button", { name: "Receive" }).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "New List" })).toBeTruthy();
  cleanup();
  state.can = { "orders.receive": false };
  render(<JobsClient initialJobs={[]} />);
  expect(screen.queryByRole("button", { name: "Receive" })).toBeNull();
  state.materialListId = "list";
  state.can = { "orders.send": false, "quotes.create": false };
});

it("opens lists in the job workspace on the same screen as their own page", () => {
  state.kind = "materials";
  state.materialListId = "list";
  state.items = [
    { id: "a", quantity: "1", partDefinition: { id: "part" } },
    {
      id: "b",
      quantity: "1",
      partDefinition: { id: "part" },
      sentOrderItemId: "oi",
      sentOrder: { id: "order", number: "PO-9", status: "sent", quantity: "1", receivedQuantity: "0", verificationStatus: "pending" },
    },
  ];
  render(<JobsClient initialJobs={[]} />);
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Not ordered", "PO-9"]);
});

it("withholds list creation from verification-only members and while permissions are unavailable", () => {
  state.materialListId = null;
  for (const can of [{ "orders.receive": true, "lists.edit": false }, {}] as Record<string, boolean>[]) {
    state.can = can;
    render(<JobsClient initialJobs={[]} />);
    expect(screen.queryByRole("button", { name: /New (Material )?List/ })).toBeNull();
    expect(screen.queryByText(/Start one for this job/)).toBeNull();
    cleanup();
  }
  state.materialListId = "list";
  state.can = { "orders.send": false, "quotes.create": false };
});


it("keeps the cached job badge visible while an active revisit refreshes, and pauses until resume", async () => {
  state.materialListId = null;
  state.view = "material-lists";
  let resolve!: (value: { unreadCount: number }) => void;
  const refresh = new Promise<{ unreadCount: number }>((yes) => {
    resolve = yes;
  });
  state.overviewLoad.mockReturnValue(refresh);
  const tree = render(<JobsClient initialJobs={[]} />);
  const client = queryClients.at(-1)!;
  const key = [["chat", "getOverview"], { input: { jobId: "job" }, type: "query" }];
  client.setQueryDefaults(key, { staleTime: 300_000 });
  client.setQueryData(key, { unreadCount: 7 });
  state.view = "options";
  tree.rerender(
    <QueryClientProvider client={client}>
      <JobsClient initialJobs={[]} />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText("Job chat unread")).toHaveTextContent("7");
  await waitFor(() => expect(state.overviewLoad).toHaveBeenCalledTimes(1));
  await act(async () => {
    resolve({ unreadCount: 9 });
    await refresh;
  });
  await waitFor(() => expect(screen.getByLabelText("Job chat unread")).toHaveTextContent("9"));
  act(() => setAppPageActive(false));
  expect(client.getQueryCache().find({ queryKey: key, exact: true })?.isActive()).toBe(false);
  expect(state.overviewLoad).toHaveBeenCalledTimes(1);
  act(() => setAppPageActive(true));
  await waitFor(() => expect(state.overviewLoad).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("Job chat unread")).toHaveTextContent("9");
});
