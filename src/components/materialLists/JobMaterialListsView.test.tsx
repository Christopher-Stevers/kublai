import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { JobMaterialListsView } from "./JobMaterialListsView";
vi.mock("~/hooks/use-remembered-scroll", () => ({
  useRememberedScroll: vi.fn(),
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/hooks/use-workspace-mutations", () => ({
  useWorkspaceMutations: () => ({ requestSync: vi.fn() }),
}));
vi.mock("~/components/tutorial/tutorial-sandbox-context", () => ({
  useTutorialSandbox: () => null,
}));
vi.mock("./use-card-merge", () => ({ useCardMerge: () => ({}) }));
vi.mock("./ScanSlipButton", () => ({ ScanSlipButton: () => null }));
vi.mock("./MaterialListCard", () => ({
  MaterialListCard: ({
    list,
    onOpen,
  }: {
    list: { name: string };
    onOpen: () => void;
  }) => <button onClick={onOpen}>{list.name}</button>,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    user: {
      getMyRole: { useQuery: () => ({ data: { permissions: { can: {} } } }) },
    },
    materialList: { duplicate: { useMutation: () => ({}) } },
  },
}));
afterEach(cleanup);
it("lets read-only users search lists by contained parts, open a result, and clear the filter", () => {
  const onOpen = vi.fn();
  const lists = [
    {
      id: "a",
      name: "Monday",
      itemCount: 1,
      materialTotal: 0,
      createdAt: "2026-10-26",
      partSearchTexts: ["xfr elbow"],
    },
    {
      id: "b",
      name: "Tuesday",
      itemCount: 1,
      materialTotal: 0,
      createdAt: "2026-10-26",
      partSearchTexts: ["copper cap"],
    },
  ];
  render(<JobMaterialListsView jobId="job" lists={lists} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const input = screen.getByRole("searchbox", {
    name: "Search parts in material lists",
  });
  // The search takes over the whole bar until it is closed.
  expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  fireEvent.change(input, { target: { value: "cap" } });
  expect(
    screen.queryByRole("button", { name: "Monday" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tuesday" }));
  expect(onOpen).toHaveBeenCalledWith("b");
  expect(screen.getByRole("status")).toHaveTextContent("1 of 2");
  fireEvent.change(input, { target: { value: "nothing" } });
  expect(
    screen.getByText("No material lists contain a matching part."),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close search" }));
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Monday" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tuesday" })).toBeInTheDocument();
});
