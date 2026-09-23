import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  configured: true,
  online: true,
  mode: "search",
  mutation: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ mode: mocks.mode }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => mocks.online,
}));
vi.mock("~/components/catalogue/PartDetailsDialog", () => ({
  PartDetailsDialog: () => null,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    assist: {
      status: { useQuery: () => ({ data: { configured: mocks.configured } }) },
      sources: {
        useQuery: () => ({
          data: [{ id: "source", label: "Test material list" }],
        }),
      },
      run: {
        useMutation: () => ({
          mutateAsync: mocks.mutation,
          reset: vi.fn(),
          isPending: false,
        }),
      },
    },
    user: {
      getMyRole: {
        useQuery: () => ({
          data: {
            permissions: {
              canEditParts: true,
              tabAccess: { catalogue: true, suppliers: true, dashboard: true },
            },
          },
        }),
      },
    },
  },
}));
import { AssistancePanel } from "./AssistancePanel";
beforeEach(() => {
  mocks.configured = true;
  mocks.online = true;
  mocks.mode = "search";
  mocks.mutation.mockReset();
});
afterEach(cleanup);
it("shows all tools and a clear disconnected state without making a provider request", () => {
  mocks.configured = false;
  render(<AssistancePanel />);
  expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(5);
  expect(
    screen.getByText(/administrator needs to connect TypeSafe/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Get suggestions" }),
  ).toBeDisabled();
  expect(mocks.mutation).not.toHaveBeenCalled();
});
it("disables requests offline", () => {
  mocks.online = false;
  render(<AssistancePanel />);
  fireEvent.change(screen.getByLabelText("Describe the material"), {
    target: { value: "Copper elbow" },
  });
  expect(
    screen.getByRole("button", { name: "Get suggestions" }),
  ).toBeDisabled();
  expect(screen.getByText(/needs an internet connection/)).toBeInTheDocument();
});
it("runs a real UI search, renders uncertainty, and supports review marks and filtering", async () => {
  mocks.mutation.mockResolvedValue({
    results: [
      {
        id: "one",
        title: "Copper elbow",
        outcome: "Check the specifications",
        choice: "uncertain",
        confidence: 0.4,
        probability: 0.6,
        priority: "review",
        reason: "Check source",
        href: "/dashboard/catalogue",
        partId: "part",
      },
      {
        id: "two",
        title: "Copper tee",
        outcome: "Does not match",
        choice: "different",
        confidence: 0.9,
        probability: 0.95,
        priority: "suggestion",
        reason: "Check source",
        href: "/dashboard/catalogue",
        partId: "part2",
      },
    ],
    note: "No records changed.",
    nextOffset: null,
    model: "test",
  });
  render(<AssistancePanel />);
  fireEvent.change(screen.getByLabelText("Describe the material"), {
    target: { value: "cu ell" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Get suggestions" }));
  await screen.findByText("Copper elbow");
  expect(mocks.mutation).toHaveBeenCalledWith({
    mode: "search",
    id: undefined,
    query: "cu ell",
    offset: 0,
  });
  expect(screen.getByText("1 need closer review")).toBeInTheDocument();
  fireEvent.click(
    screen.getByLabelText("Show only uncertain or flagged results"),
  );
  expect(screen.queryByText("Copper tee")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
  expect(screen.getByText("0 need closer review")).toBeInTheDocument();
  expect(mocks.mutation).toHaveBeenCalledTimes(1);
});
it("requires a selected source and clears stale suggestions on tool changes", async () => {
  mocks.mode = "materials";
  mocks.mutation.mockResolvedValue({
    results: [],
    nextOffset: null,
    note: "No matches",
  });
  render(<AssistancePanel />);
  expect(
    screen.getByRole("button", { name: "Get suggestions" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "source" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Get suggestions" }));
  await waitFor(() =>
    expect(mocks.mutation).toHaveBeenCalledWith({
      mode: "materials",
      id: "source",
      query: "",
      offset: 0,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Classify a drawing/ }));
  expect(screen.getByRole("combobox")).toHaveValue("");
  expect(screen.queryByText("No matches")).not.toBeInTheDocument();
});
