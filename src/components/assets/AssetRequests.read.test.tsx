import type { ReactNode } from "react";
import type * as SharedModule from "./shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAppPageActive } from "~/lib/app-page-activity";

const fixture = vi.hoisted(() => ({
  online: true,
  search: "",
  requests: vi.fn<(input: unknown) => Promise<unknown>>(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: fixture.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(fixture.search),
  usePathname: () => "/jobs/assets/requests",
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => fixture.online,
  getBrowserOnlineStatus: () => fixture.online,
}));
vi.mock("./TagScanner", () => ({ TagScanner: () => null }));
// Only the page frame is replaced: actual rows, empty/error states, read notice,
// shared formatting and actual refresh-behind hook remain under test.
vi.mock("./shared", async (importOriginal) => {
  const actual = await importOriginal<typeof SharedModule>();
  return {
    ...actual,
    AssetsShell: ({
      title,
      children,
    }: {
      title: string;
      children: ReactNode;
    }) => (
      <section>
        <h1>{title}</h1>
        {children}
      </section>
    ),
  };
});
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const endpoint = (name: string, fallback: unknown) => ({
    _def: () => ({ path: ["assets", name] }),
    useQuery: (input: unknown, options: object) =>
      useQuery({
        ...options,
        queryKey:
          input === undefined
            ? [["assets", name], { type: "query" }]
            : [["assets", name], { input, type: "query" }],
        queryFn: () =>
          name === "listRequests"
            ? fixture.requests(input)
            : Promise.resolve(fallback),
      }),
  });
  return {
    api: {
      useUtils: () => ({ assets: { invalidate: vi.fn() } }),
      assets: {
        listRequests: endpoint("listRequests", []),
        overview: endpoint("overview", {
          isSetUp: true,
          tools: {
            total: 0,
            retired: 0,
            available: 0,
            inUse: 0,
            damaged: 0,
            missing: 0,
          },
          openRequests: 1,
          openReturns: 0,
          openCounts: 0,
        }),
        holders: endpoint("holders", {
          me: null,
          users: [],
          jobs: [],
          locations: [],
        }),
        listAssets: endpoint("listAssets", []),
        setup: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  };
});
import { RequestsView } from "./RequestsView";
import { AssetsOverview } from "./AssetsOverview";
const clients: QueryClient[] = [];
const key = (input: object) => [
  ["assets", "listRequests"],
  { input, type: "query" },
];
const overview = {
  isSetUp: true,
  tools: {
    total: 0,
    retired: 0,
    available: 0,
    inUse: 0,
    damaged: 0,
    missing: 0,
  },
  openRequests: 1,
  openReturns: 0,
  openCounts: 0,
};
const row = (orderNumber = "REQ-1") => ({
  id: orderNumber,
  orderNumber,
  kind: "tool_request",
  fulfillmentStatus: "open",
  jobName: "Synthetic job",
  requestedBy: "Synthetic requester",
  sentAt: null,
  fulfilledQuantity: 0,
  totalQuantity: 10,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 300_000, retry: false, gcTime: Infinity },
    },
  });
  clients.push(client);
  client.setQueryData([["assets", "overview"], { type: "query" }], overview);
  return {
    client,
    wrap: (node: ReactNode) => (
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    ),
  };
}
beforeEach(() => {
  fixture.online = true;
  fixture.search = "";
  fixture.requests.mockReset().mockResolvedValue([row()]);
  fixture.replace.mockReset();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  setAppPageActive(true);
});

for (const [name, Component, input] of [
  ["request list", RequestsView, { status: "open", kind: undefined }],
  ["overview requests", AssetsOverview, { status: "open" }],
] as const) {
  it(`${name}: fresh cached rows paint immediately while a real query is pending, then replace on success`, async () => {
    const { client, wrap } = setup();
    const response = deferred<ReturnType<typeof row>[]>();
    client.setQueryData(key(input), [row("CACHED")]);
    fixture.requests.mockReturnValue(response.promise);
    render(wrap(<Component />));
    expect(screen.getByRole("link", { name: /CACHED/ })).toHaveAttribute(
      "href",
      "/jobs/assets/requests/CACHED",
    );
    await waitFor(() => expect(fixture.requests).toHaveBeenCalledOnce());
    expect(fixture.requests).toHaveBeenCalledWith(input);
    await act(async () => response.resolve([row("FRESH")]));
    await screen.findByRole("link", { name: /FRESH/ });
    expect(screen.queryByText("CACHED")).not.toBeInTheDocument();
  });
  it(`${name}: transient refresh keeps cached rows with notice; a terminal denial hides them`, async () => {
    const { client, wrap } = setup();
    const failed = deferred<ReturnType<typeof row>[]>();
    client.setQueryData(key(input), [row("SAVED")]);
    fixture.requests.mockReturnValue(failed.promise);
    render(wrap(<Component />));
    await waitFor(() => expect(fixture.requests).toHaveBeenCalledOnce());
    await act(async () => failed.reject(new Error("Connection interrupted")));
    await screen.findByText(/Showing saved data/);
    expect(screen.getByRole("link", { name: /SAVED/ })).toBeInTheDocument();
    fixture.requests.mockRejectedValueOnce(
      Object.assign(new Error("Access denied"), {
        data: { code: "FORBIDDEN" },
      }),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: key(input), exact: true });
    });
    await screen.findByText("Access denied");
    expect(
      screen.queryByRole("link", { name: /SAVED/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing saved data/)).not.toBeInTheDocument();
  });
  it(`${name}: uncached offline is unknown, while a real cached empty result remains empty`, () => {
    fixture.online = false;
    const { client, wrap } = setup();
    const view = render(wrap(<Component />));
    expect(
      screen.getByText(
        "Requests are unavailable offline. Connect to load them.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing waiting/)).not.toBeInTheDocument();
    expect(fixture.requests).not.toHaveBeenCalled();
    view.unmount();
    client.setQueryData(key(input), []);
    render(wrap(<Component />));
    expect(screen.getByText(/Nothing waiting/)).toBeInTheDocument();
    expect(fixture.requests).not.toHaveBeenCalled();
  });
}
it("status and kind changes use only their exact existing query keys", async () => {
  const { client, wrap } = setup();
  const pending = deferred<ReturnType<typeof row>[]>();
  fixture.requests.mockReturnValue(pending.promise);
  client.setQueryData(key({ status: "open", kind: "tool_request" }), [
    row("OPEN-REQUEST"),
  ]);
  client.setQueryData(key({ status: "done", kind: "tool_return" }), [
    row("DONE-RETURN"),
  ]);
  fixture.search = "status=open&kind=tool_request";
  const view = render(wrap(<RequestsView />));
  expect(screen.getByText("OPEN-REQUEST")).toBeInTheDocument();
  await waitFor(() =>
    expect(fixture.requests).toHaveBeenCalledWith({
      status: "open",
      kind: "tool_request",
    }),
  );
  fixture.search = "status=done&kind=tool_return";
  view.rerender(wrap(<RequestsView />));
  expect(screen.getByText("DONE-RETURN")).toBeInTheDocument();
  expect(screen.queryByText("OPEN-REQUEST")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(fixture.requests).toHaveBeenCalledWith({
      status: "done",
      kind: "tool_return",
    }),
  );
  await act(async () => pending.resolve([]));
});
