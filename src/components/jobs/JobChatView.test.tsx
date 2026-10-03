import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as DraftStorage from "~/lib/job-chat-drafts";
import type { ChatMessage } from "~/server/chat/contracts";
import { JobChatView } from "./JobChatView";

const mock = vi.hoisted(() => ({
  online: true,
  userId: "user-one",
  saved: null as unknown,
  saveDraft: vi.fn().mockResolvedValue(undefined),
  send: vi.fn(),
  remove: vi.fn(),
  join: vi.fn(),
  markRead: vi.fn().mockResolvedValue({}),
  mute: vi.fn(),
  fetchOlder: vi.fn(),
  overview: {
    unreadCount: 0,
    latestSequence: 2,
    joined: true,
    muted: false,
    userId: "user-one",
    canModerate: false,
  },
  history: {
    messages: [] as ChatMessage[],
    nextBeforeSequence: null as number | null,
    latestSequence: 2,
  },
  invalidate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: mock.userId, isLoaded: true }),
}));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => mock.online,
}));
vi.mock("./ChatNotifications", () => ({
  ChatNotifications: () => <span>Device notifications</span>,
}));
vi.mock("~/components/ui/app-dialogs", () => ({
  confirmAction: vi.fn().mockResolvedValue(true),
}));
vi.mock("~/lib/job-chat-drafts", async (importOriginal) => ({
  ...(await importOriginal<typeof DraftStorage>()),
  loadChatDraft: vi.fn(async () => mock.saved),
  saveChatDraft: mock.saveDraft,
}));
const utils = {
  chat: {
    getOverview: { invalidate: mock.invalidate },
    history: {
      invalidate: mock.invalidate,
      fetch: mock.fetchOlder,
      setData: (
        _input: unknown,
        updater: (data: typeof mock.history) => typeof mock.history,
      ) => {
        mock.history = updater(mock.history);
      },
    },
  },
};
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => utils,
    chat: {
      getOverview: { useQuery: () => ({ data: mock.overview, error: null }) },
      history: {
        useQuery: () => ({
          data: mock.history,
          isLoading: false,
          error: null,
          dataUpdatedAt: 1,
        }),
      },
      members: { useQuery: () => ({ data: [], isLoading: false }) },
      join: {
        useMutation: () => ({ mutateAsync: mock.join, isPending: false }),
      },
      send: {
        useMutation: () => ({ mutateAsync: mock.send, isPending: false }),
      },
      delete: {
        useMutation: () => ({ mutateAsync: mock.remove, isPending: false }),
      },
      markRead: {
        useMutation: () => ({ mutateAsync: mock.markRead, isPending: false }),
      },
      setNotifications: {
        useMutation: () => ({ mutateAsync: mock.mute, isPending: false }),
      },
    },
  },
}));
function message(sequence: number, body = `Message ${sequence}`): ChatMessage {
  return {
    id: `message-${sequence}`,
    sequence,
    jobId: "job-one",
    clientId: `server-${sequence}`,
    body,
    author: { id: "other-user", name: "Crew member", image: null },
    replyToId: null,
    createdAt: new Date("2026-10-02T12:00:00Z"),
    editedAt: null,
    deletedAt: null,
    attachments: [],
  };
}
function longPress(element: HTMLElement) {
  vi.useFakeTimers();
  try {
    fireEvent.pointerDown(element, {
      pointerType: "touch",
      clientX: 5,
      clientY: 5,
    });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerUp(element);
  } finally {
    vi.useRealTimers();
  }
}
async function openChat() {
  const view = render(<JobChatView jobId="job-one" />);
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Message" })).not.toBeDisabled(),
  );
  return view;
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.online = true;
  mock.userId = "user-one";
  mock.saved = null;
  mock.overview = {
    unreadCount: 0,
    latestSequence: 2,
    joined: true,
    muted: false,
    userId: "user-one",
    canModerate: false,
  };
  mock.history = {
    messages: [message(1), message(2)],
    nextBeforeSequence: null,
    latestSequence: 2,
  };
  mock.markRead.mockResolvedValue({});
  mock.saveDraft.mockResolvedValue(undefined);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  vi.stubGlobal("EventSource", undefined);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("job chat delivery and scrolling", () => {
  it("keeps a failed message and retries exactly the same idempotency key without duplicating it", async () => {
    mock.send
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockImplementationOnce(
        async (input: { clientId: string; body: string }) => ({
          ...message(3, input.body),
          clientId: input.clientId,
          author: { id: "user-one", name: "You", image: null },
        }),
      );
    await openChat();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Bring the drawings" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Connection lost"),
    );
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Bring the drawings",
    );
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(""),
    );
    expect(mock.send.mock.calls[0]![0]).toEqual(mock.send.mock.calls[1]![0]);
    expect(screen.getAllByText("Bring the drawings")).toHaveLength(1);
    expect(mock.saveDraft).toHaveBeenLastCalledWith("user-one:job-one", null);
  });

  it("retains files and text after upload failure and allows removal before delivery was attempted", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Upload failed"));
    await openChat();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Site photo" },
    });
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [new File(["photo"], "site.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Upload failed"),
    );
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Site photo",
    );
    expect(screen.getByRole("textbox", { name: "Message" })).not.toBeDisabled();
    expect(screen.getByText("site.png")).toBeInTheDocument();
    expect(mock.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove site.png" }));
    expect(screen.queryByText("site.png")).not.toBeInTheDocument();
  });

  it("does not send or mark read while offline, and preserves the draft for a manual reconnect send", async () => {
    mock.online = false;
    const view = await openChat();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Offline draft" },
    });
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(mock.markRead).not.toHaveBeenCalled();
    mock.online = true;
    view.rerender(<JobChatView jobId="job-one" />);
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Offline draft",
    );
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("does not mark messages read in a hidden tab", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await openChat();
    expect(mock.markRead).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() =>
      expect(mock.markRead).toHaveBeenCalledWith({
        jobId: "job-one",
        sequence: 2,
      }),
    );
  });

  it("keeps the reader at earlier messages when a new message arrives", async () => {
    const view = await openChat();
    const timeline = screen.getByLabelText("Messages");
    Object.defineProperties(timeline, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
    });
    timeline.scrollTop = 100;
    fireEvent.scroll(timeline);
    mock.markRead.mockClear();
    mock.history = {
      ...mock.history,
      messages: [...mock.history.messages, message(3)],
      latestSequence: 3,
    };
    view.rerender(<JobChatView jobId="job-one" />);
    expect(timeline.scrollTop).toBe(100);
    expect(mock.markRead).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Jump to latest messages ↓" }),
    );
    await waitFor(() =>
      expect(mock.markRead).toHaveBeenCalledWith({
        jobId: "job-one",
        sequence: 3,
      }),
    );
  });

  it("merges overlapping history pages without duplicate messages", async () => {
    mock.history = {
      messages: [message(2), message(3)],
      nextBeforeSequence: 3,
      latestSequence: 3,
    };
    mock.fetchOlder.mockResolvedValue({
      messages: [message(1), message(2)],
      nextBeforeSequence: null,
      latestSequence: 3,
    });
    await openChat();
    fireEvent.click(
      screen.getByRole("button", { name: "Load earlier messages" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Message 1")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Message 2")).toHaveLength(1);
  });

  it("keeps drafts isolated when the signed-in user changes", async () => {
    const view = await openChat();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Private draft" },
    });
    mock.userId = "user-two";
    view.rerender(<JobChatView jobId="job-one" />);
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Message" }),
      ).not.toBeDisabled(),
    );
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("");
    expect(mock.saveDraft).toHaveBeenCalledWith(
      "user-one:job-one",
      expect.objectContaining({ body: "Private draft" }),
    );
  });
  it("reuses uploaded attachments and the message UUID after an ambiguous send failure", async () => {
    const attachment = {
      id: "attachment-one",
      name: "site.png",
      mimeType: "image/png",
      size: 5,
      url: "/api/job-chat/attachments/attachment-one",
    };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ attachment }),
    } as Response);
    mock.send
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockImplementationOnce(
        async (input: { body: string; clientId: string }) => ({
          ...message(3, input.body),
          clientId: input.clientId,
          author: { id: "user-one", name: "You", image: null },
          attachments: [attachment],
        }),
      );
    await openChat();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(["photo"], "site.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Response lost"),
    );
    expect(screen.getByText("site.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Open site.png" }),
      ).toBeInTheDocument(),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mock.send.mock.calls[0]![0]).toEqual(mock.send.mock.calls[1]![0]);
    expect(mock.send).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentIds: ["attachment-one"] }),
    );
  });

  it("hides message actions until a long press, then replies and keeps other people's messages read-only", async () => {
    mock.send.mockImplementationOnce(
      async (input: { body: string; clientId: string; replyToId: string }) => ({
        ...message(3, input.body),
        clientId: input.clientId,
        replyToId: input.replyToId,
        author: { id: "user-one", name: "You", image: null },
      }),
    );
    await openChat();
    expect(screen.queryByRole("menuitem", { name: "Reply" })).toBeNull();
    longPress(screen.getByText("Message 1"));
    expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Reply" }));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Agreed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(mock.send).toHaveBeenCalledWith(
        expect.objectContaining({ replyToId: "message-1", body: "Agreed" }),
      ),
    );
  });

  it("keeps the notifications panel to notifications and muting", async () => {
    await openChat();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("Device notifications")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mute this job" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Home Screen/ })).toBeNull();
  });

  it("lets an Executive delete a job message from the long-press menu, with no editing", async () => {
    mock.overview.canModerate = true;
    mock.remove.mockResolvedValue({ success: true });
    await openChat();
    fireEvent.contextMenu(screen.getByText("Message 1"));
    expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.getByText("Message deleted")).toBeInTheDocument(),
    );
    expect(mock.remove).toHaveBeenCalledWith({
      jobId: "job-one",
      messageId: "message-1",
    });
  });

  it("retains the previous latest page when a busy conversation shifts its window", async () => {
    mock.fetchOlder.mockResolvedValue({
      messages: [message(1), message(2)],
      nextBeforeSequence: null,
      latestSequence: 3,
    });
    const view = await openChat();
    mock.history = {
      messages: [message(2), message(3)],
      nextBeforeSequence: 2,
      latestSequence: 3,
    };
    view.rerender(<JobChatView jobId="job-one" />);
    await waitFor(() =>
      expect(screen.getByText("Message 3")).toBeInTheDocument(),
    );
    expect(screen.getByText("Message 1")).toBeInTheDocument();
    expect(screen.getAllByText("Message 2")).toHaveLength(1);
  });
  it("never acknowledges a server sequence beyond the messages actually displayed", async () => {
    mock.history.latestSequence = 500;
    mock.overview.latestSequence = 500;
    await openChat();
    expect(mock.markRead).toHaveBeenCalledWith({
      jobId: "job-one",
      sequence: 2,
    });
    expect(mock.markRead).not.toHaveBeenCalledWith({
      jobId: "job-one",
      sequence: 500,
    });
  });

  it.each(["BAD_REQUEST", "TOO_MANY_REQUESTS"])(
    "allows correcting a definitively rejected %s message without automatic resend",
    async (code) => {
      mock.send.mockRejectedValueOnce(
        Object.assign(new Error("Message rejected"), { data: { code } }),
      );
      await openChat();
      fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
        target: { value: "Initial wording" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent("Message rejected"),
      );
      expect(
        screen.getByRole("textbox", { name: "Message" }),
      ).not.toBeDisabled();
      fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
        target: { value: "Corrected wording" },
      });
      expect(mock.send).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: "Send message" }),
      ).not.toBeDisabled();
    },
  );

  it("retains original file bytes but clears expired upload metadata after a proven rejection", async () => {
    const file = new File(["photo"], "site.png", { type: "image/png" });
    mock.saved = {
      clientId: "draft-client",
      body: "Site",
      attempted: true,
      attachments: [
        {
          localId: "local-file",
          file,
          name: file.name,
          size: file.size,
          type: file.type,
          uploaded: {
            id: "expired",
            url: "/api/job-chat/attachments/expired",
            name: file.name,
            size: file.size,
            mimeType: file.type,
          },
        },
      ],
    };
    mock.send.mockRejectedValueOnce(
      Object.assign(
        new Error("An attachment is unavailable. Upload it again."),
        { data: { code: "BAD_REQUEST" } },
      ),
    );
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    render(<JobChatView jobId="job-one" />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry message" }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Message" }),
      ).not.toBeDisabled(),
    );
    expect(mock.saveDraft).toHaveBeenLastCalledWith(
      "user-one:job-one",
      expect.objectContaining({
        attempted: false,
        attachments: [expect.objectContaining({ file, uploaded: undefined })],
      }),
    );
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect(screen.getByText("site.png")).toBeInTheDocument();
  });
});
