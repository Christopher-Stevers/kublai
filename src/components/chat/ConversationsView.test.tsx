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
  fetchOlder: vi.fn(),
  sequence: 1,
  next: null as number | null,
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
        history: { invalidate: mocks.invalidate, fetch: mocks.fetchOlder },
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
                sequence: mocks.sequence,
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
            nextBeforeSequence: mocks.next,
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
import { ChatViewProvider } from "./ChatViewProvider";
import { ConversationsView } from "./ConversationsView";
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.sequence = 1;
  mocks.next = null;
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
  expect(
    within(screen.getByRole("main", { name: "Current chat" })).queryByRole(
      "heading",
      { name: "Site A" },
    ),
  ).toBeNull();
  expect(
    within(screen.getByRole("main", { name: "Current chat" })).queryByText(
      "Job team",
    ),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Review group/ }));
  expect(mocks.push).toHaveBeenLastCalledWith(
    "/dashboard/chat?conversation=room",
    { scroll: false },
  );
});
it("opens the available chats from the main Chat button, then searches and selects", () => {
  render(<ConversationsView />);
  fireEvent.click(screen.getByRole("button", { name: "Chat" }));
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
  const original: unknown = mocks.send.mock.calls[0]?.[0];
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

it("returns to the selected conversation, draft, search and reading position after leaving Chat", () => {
  const page = (visible: boolean) => (
    <ChatViewProvider>
      {visible ? <ConversationsView /> : <div>Other page</div>}
    </ChatViewProvider>
  );
  const view = render(page(true));
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Keep this draft" },
  });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search chats" }), {
    target: { value: "Review" },
  });
  const timeline = screen.getByLabelText("Messages");
  Object.defineProperties(timeline, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 400 },
  });
  timeline.scrollTop = 640;
  fireEvent.scroll(timeline);
  view.rerender(page(false));
  mocks.params = "";
  view.rerender(page(true));
  expect(screen.getByText("Private review")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Keep this draft",
  );
  expect(screen.getByRole("searchbox", { name: "Search chats" })).toHaveValue(
    "Review",
  );
  expect(screen.getByLabelText("Messages").scrollTop).toBe(640);
  mocks.params = "job=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  view.rerender(page(true));
  expect(screen.getByTestId("job-thread")).toBeVisible();
  view.rerender(page(false));
  mocks.params = "";
  view.rerender(page(true));
  expect(screen.getByTestId("job-thread")).toBeVisible();
});
it("reloads older messages and restores the reading position after a full page navigation", async () => {
  mocks.sequence = 10;
  mocks.next = 10;
  mocks.fetchOlder.mockResolvedValue({
    messages: [
      {
        id: "earlier",
        sequence: 2,
        author: { id: "recipient", name: "Recipient" },
        body: "Earlier review",
        attachments: [],
        source: null,
        createdAt: new Date(),
        deletedAt: null,
      },
    ],
    nextBeforeSequence: null,
  });
  const view = render(
    <ChatViewProvider scope="test-account">
      <ConversationsView />
    </ChatViewProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Load earlier messages" }),
  );
  await screen.findByText("Earlier review");
  const timeline = screen.getByLabelText("Messages");
  Object.defineProperties(timeline, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 400 },
  });
  timeline.scrollTop = 420;
  fireEvent.scroll(timeline);
  view.unmount();
  const saved = sessionStorage.getItem("foremanhq-chat-view:test-account");
  expect(saved).not.toContain("Earlier review");
  expect(saved).not.toContain("Private review");
  mocks.params = "";
  mocks.fetchOlder.mockClear();
  render(
    <ChatViewProvider scope="test-account">
      <ConversationsView />
    </ChatViewProvider>,
  );
  await screen.findByText("Earlier review");
  expect(mocks.fetchOlder).toHaveBeenCalledWith({
    conversationId: "room",
    beforeSequence: 10,
    limit: 50,
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Messages").scrollTop).toBe(420),
  );
});
it("does not restore another account's private chat", async () => {
  const view = render(
    <ChatViewProvider key="one" scope="one">
      <ConversationsView />
    </ChatViewProvider>,
  );
  await screen.findByText("Private review");
  mocks.params = "";
  view.rerender(
    <ChatViewProvider key="two" scope="two">
      <ConversationsView />
    </ChatViewProvider>,
  );
  await waitFor(() =>
    expect(screen.queryByText("Private review")).not.toBeInTheDocument(),
  );
  expect(
    screen.getByText("Choose a direct, group or job chat from the list."),
  ).toBeVisible();
});
