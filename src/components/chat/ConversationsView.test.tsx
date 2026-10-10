import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
  invalidate: vi.fn(),
  push: vi.fn(),
  denied: false,
  deleted: false,
  source: null as null | { href: string; title: string; capturedAt: string },
  own: false,
  image: false,
  params: "conversation=room",
  create: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(mocks.params),
}));
vi.mock("next/dynamic", () => ({
  default:
    () => (props: { jobId: string; embedded: boolean; userId?: string }) => (
      <div
        data-testid="job-thread"
        data-job={props.jobId}
        data-embedded={props.embedded}
        data-user={props.userId}
      >
        Job messages
      </div>
    ),
}));
vi.mock("~/hooks/use-replicache-jobs", () => ({
  useReplicacheJobsList: () => [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Site A" },
  ],
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      conversations: {
        list: { invalidate: mocks.invalidate },
        history: { invalidate: mocks.invalidate },
      },
    }),
    conversations: {
      list: {
        useQuery: () => ({
          data: {
            userId: "sender",
            conversations: [
              {
                id: "room",
                name: "Review group",
                kind: "group",
                unreadCount: 0,
                members: [
                  { id: "sender", name: "Sender" },
                  { id: "recipient", name: "Recipient" },
                ],
              },
              {
                id: "direct-other",
                name: "Alex",
                kind: "direct",
                unreadCount: 2,
                members: [{ id: "recipient", name: "Alex" }],
              },
            ],
          },
        }),
      },
      people: {
        useQuery: () => ({
          data: [{ id: "alex", name: "Alex", email: "alex@example.test" }],
        }),
      },
      create: {
        useMutation: () => ({ mutateAsync: mocks.create, isPending: false }),
      },
      history: {
        useQuery: () => ({
          data: {
            messages: [
              {
                id: "message",
                sequence: 1,
                author: {
                  id: mocks.own ? "sender" : "recipient",
                  name: "Recipient",
                },
                body: "Private review",
                attachments: mocks.image
                  ? [
                      {
                        id: "image",
                        mimeType: "image/png",
                        name: "snapshot.png",
                        url: "/image",
                      },
                    ]
                  : [],
                source: mocks.source,
                createdAt: new Date(),
                deletedAt: mocks.deleted ? new Date() : null,
              },
            ],
            nextBeforeSequence: null,
          },
          error: mocks.denied ? { data: { code: "FORBIDDEN" } } : null,
        }),
      },
      send: { useMutation: () => ({ mutateAsync: mocks.send }) },
      remove: { useMutation: () => ({ mutateAsync: mocks.remove }) },
      markRead: { useMutation: () => ({ mutateAsync: mocks.read }) },
    },
  },
}));
import { ConversationsView } from "./ConversationsView";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.denied = false;
  mocks.deleted = false;
  mocks.source = null;
  mocks.own = false;
  mocks.image = false;
  mocks.params = "conversation=room";
  mocks.create.mockResolvedValue({ id: "direct-other" });
  mocks.send.mockResolvedValue({ id: "sent" });
  mocks.read.mockResolvedValue(undefined);
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("keeps snapshot source links without edit or delete controls in chat", () => {
  mocks.own = true;
  mocks.image = true;
  mocks.source = {
    href: "/dashboard/jobs/job/drawings?drawingSheet=sheet#snapshot=recorded",
    title: "Drawing",
    capturedAt: "2026-10-09T22:00:00Z",
  };
  const view = render(<ConversationsView />);
  expect(
    screen.getByRole("link", { name: "Open snapshot source" }),
  ).toHaveAttribute("href", mocks.source.href);
  expect(screen.getByAltText("snapshot.png")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Edit snapshot" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Delete message/ }),
  ).not.toBeInTheDocument();
  mocks.source = null;
  view.rerender(<ConversationsView />);
  expect(
    screen.queryByRole("button", { name: /Delete message/ }),
  ).not.toBeInTheDocument();
  mocks.image = false;
  view.rerender(<ConversationsView />);
  expect(screen.getByRole("button", { name: /Delete message/ })).toBeVisible();
});
it("opens a snapshot's recorded local view and hides the link when the message is deleted", () => {
  mocks.source = {
    href: "/dashboard/jobs/test/drawings#snapshot=recorded-view",
    title: "Mechanical drawing",
    capturedAt: "2026-10-09T18:00:00Z",
  };
  const view = render(<ConversationsView />);
  expect(
    screen.getByRole("link", { name: "Open snapshot source" }),
  ).toHaveAttribute("href", mocks.source.href);
  mocks.deleted = true;
  view.rerender(<ConversationsView />);
  expect(
    screen.queryByRole("link", { name: "Open snapshot source" }),
  ).not.toBeInTheDocument();
});
it("keeps an uncertain message immutable and reuses its client identity on retry", async () => {
  mocks.send.mockRejectedValueOnce(new Error("Connection interrupted"));
  render(<ConversationsView />);
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Check this run" },
  });
  fireEvent.click(screen.getByLabelText("Send message"));
  await screen.findByText("Connection interrupted");
  expect(screen.getByLabelText("Message")).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Retry message"));
  await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1]);
});
it("hides cached private messages and disables sending after access is revoked", () => {
  mocks.denied = true;
  render(<ConversationsView />);
  expect(screen.queryByText("Private review")).not.toBeInTheDocument();
  expect(
    screen.getByText("This conversation is unavailable."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Message")).toBeDisabled();
});

it("keeps notification controls out of person and group chats", () => {
  render(<ConversationsView />);
  expect(
    screen.queryByRole("button", { name: "Device notifications" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: /push notifications/ }),
  ).toBeNull();
});

it("opens direct chats and job chats in the same workspace", () => {
  const view = render(<ConversationsView />);
  fireEvent.click(screen.getByRole("button", { name: /Alex/ }));
  expect(mocks.push).toHaveBeenLastCalledWith(
    "/dashboard/chat?conversation=direct-other",
    { scroll: false },
  );
  mocks.params = "job=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  view.rerender(<ConversationsView />);
  expect(screen.getByTestId("job-thread")).toHaveAttribute(
    "data-embedded",
    "true",
  );
  expect(screen.getByTestId("job-thread")).toHaveAttribute(
    "data-user",
    "sender",
  );
  expect(screen.getByRole("heading", { name: "Site A" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Review group/ }));
  expect(mocks.push).toHaveBeenLastCalledWith(
    "/dashboard/chat?conversation=room",
    { scroll: false },
  );
});
it("lets the phone switcher search and select another chat", () => {
  render(<ConversationsView />);
  fireEvent.click(screen.getByRole("button", { name: "Switch chat" }));
  const switcher = within(screen.getByRole("dialog"));
  fireEvent.change(switcher.getByRole("searchbox", { name: "Search chats" }), {
    target: { value: "Site A" },
  });
  expect(
    switcher.queryByRole("button", { name: /Alex/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(switcher.getByRole("button", { name: /Site A/ }));
  expect(mocks.push).toHaveBeenLastCalledWith(
    "/dashboard/chat?job=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    { scroll: false },
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps separate drafts and retry identities when switching conversations", async () => {
  mocks.send.mockRejectedValueOnce(new Error("Connection interrupted"));
  const view = render(<ConversationsView />);
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Unsent group message" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Retry message" }),
    ).not.toBeDisabled(),
  );
  const original = mocks.send.mock.calls[0]?.[0];
  mocks.params = "conversation=direct-other";
  view.rerender(<ConversationsView />);
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("");
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Unsent direct message" },
  });
  mocks.params = "conversation=room";
  view.rerender(<ConversationsView />);
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Unsent group message",
  );
  expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
  expect(mocks.send.mock.calls[1]?.[0]).toEqual(original);
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(""),
  );
  mocks.params = "conversation=direct-other";
  view.rerender(<ConversationsView />);
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Unsent direct message",
  );
});
