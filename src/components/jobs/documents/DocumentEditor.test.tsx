import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentEditorLaunch } from "~/server/documents/types";
const confirmation = vi.hoisted(() => vi.fn(async () => true));
vi.mock("~/components/ui/app-dialogs", () => ({ confirmAction: confirmation }));
import { DocumentEditor } from "./DocumentEditor";

let session: DocumentEditorLaunch;
let submissions: Array<{
  action: string;
  target: string;
  method: string;
  fields: Record<string, FormDataEntryValue>;
}>;
let saveRequests: string[];
let committedReceipts: Set<string>;
const onClose = vi.fn();
const frame = () => screen.getByTitle<HTMLIFrameElement>("Edit Scope.docx");
function message(
  MessageId: string,
  Values: Record<string, unknown> = {},
  origin = "https://office.example.com",
  source?: MessageEventSource | null,
) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        source: source === undefined ? frame().contentWindow : source,
        data: JSON.stringify({ MessageId, Values }),
      }),
    );
  });
}
async function start() {
  render(
    <DocumentEditor
      jobId="job-1"
      documentId="doc-1"
      name="Scope.docx"
      onClose={onClose}
    />,
  );
  await screen.findByTitle("Edit Scope.docx");
  await waitFor(() => expect(submissions).toHaveLength(1));
}
function ready() {
  message("App_LoadingStatus", { Status: "Frame_Ready" });
  message("App_LoadingStatus", { Status: "Document_Loaded" });
}

beforeEach(() => {
  onClose.mockReset();
  confirmation.mockReset().mockResolvedValue(true);
  submissions = [];
  saveRequests = [];
  committedReceipts = new Set();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  session = {
    actionUrl:
      "https://office.example.com/browser/editor.html?WOPISrc=https%3A%2F%2Fapp.example.com%2Fwopi%2Ffiles%2Fdoc-1",
    accessToken: "test-secret",
    accessTokenTtl: Date.now() + 7_200_000,
    wopiSrc: "https://app.example.com/wopi/files/doc-1",
    mode: "edit",
    provider: "collabora",
    documentId: "doc-1",
    versionId: "version-1",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/editor/save")) {
        if (init?.method === "POST") {
          const body = JSON.parse(init.body as string) as { requestId: string };
          saveRequests.push(body.requestId);
          return new Response(
            JSON.stringify({ requestId: body.requestId, status: "pending" }),
          );
        }
        const requestId = new URL(
          url,
          "https://app.example.com",
        ).searchParams.get("requestId")!;
        return new Response(
          JSON.stringify({
            requestId,
            status: committedReceipts.has(requestId) ? "committed" : "pending",
            ...(committedReceipts.has(requestId)
              ? {
                  versionId: "durable-version",
                  committedAt: new Date().toISOString(),
                }
              : {}),
          }),
        );
      }
      return new Response(JSON.stringify(session), { status: 200 });
    }),
  );
  vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (
    this: HTMLFormElement,
  ) {
    submissions.push({
      action: this.action,
      target: this.target,
      method: this.method,
      fields: Object.fromEntries(new FormData(this)),
    });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Collabora document editor", () => {
  it("posts tokens into the configured iframe without putting tokens in URLs or persistent DOM", async () => {
    await start();
    expect(submissions[0]).toEqual({
      action: session.actionUrl,
      method: "post",
      target: frame().name,
      fields: {
        access_token: "test-secret",
        access_token_ttl: String(session.accessTokenTtl),
      },
    });
    expect(frame()).not.toHaveAttribute("src");
    expect(document.querySelector('input[name="access_token"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("test-secret");
    expect(fetch).toHaveBeenCalledWith(
      "/api/job-documents/editor",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ jobId: "job-1", documentId: "doc-1" }),
      }),
    );
  });

  it("ignores messages from the wrong origin or window", async () => {
    await start();
    message(
      "App_LoadingStatus",
      { Status: "Document_Loaded" },
      "https://untrusted.example.com",
    );
    message(
      "App_LoadingStatus",
      { Status: "Document_Loaded" },
      "https://office.example.com",
      window,
    );
    expect(screen.getByText("Opening your document…")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    ready();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("waits for a correlated durable receipt, not the editor core acknowledgement, before closing", async () => {
    await start();
    const post = vi.spyOn(frame().contentWindow!, "postMessage");
    ready();
    message("Doc_ModifiedStatus", { Modified: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save & close" }));
    });
    expect(saveRequests).toHaveLength(1);
    expect(frame()).toHaveAttribute("inert");
    expect(frame()).toHaveAttribute("tabindex", "-1");
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('"MessageId":"Action_Save"'),
      "https://office.example.com",
    );
    const payload: unknown = post.mock.calls.find(
      ([value]) =>
        typeof value === "string" &&
        value.includes('"MessageId":"Action_Save"'),
    )?.[0];
    if (typeof payload !== "string")
      throw new Error("The editor save command was not sent.");
    const command = JSON.parse(payload) as {
      Values: { ExtendedData: string; DontSaveIfUnmodified: boolean };
    };
    expect(command.Values.ExtendedData).toBe(
      JSON.stringify({ foremanhqSaveRequestId: saveRequests[0] }),
    );
    expect(command.Values.DontSaveIfUnmodified).toBe(false);
    message("Action_Save_Resp", { success: true });
    message("Doc_ModifiedStatus", { Modified: false });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("Save confirmed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save & close" })).toBeDisabled();
    committedReceipts.add(saveRequests[0]!);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('"MessageId":"Action_Close"'),
      "https://office.example.com",
    );
    expect(
      post.mock.calls.some(
        ([payload]) =>
          typeof payload === "string" && payload.includes("Close_Session"),
      ),
    ).toBe(false);
  });

  it("never treats a core failure or unmodified response as a durable save", async () => {
    await start();
    ready();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save & close" }));
    });
    message("Action_Save_Resp", { success: false, result: "failed" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Waiting for the project server",
    );
    expect(frame()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    message("Action_Save_Resp", { success: false, result: "unmodified" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("Save confirmed")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close without saving" }),
    ).not.toBeInTheDocument();
    committedReceipts.add(saveRequests[0]!);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
  });

  it("ignores a timed-out receipt when a newer save is pending", async () => {
    await start();
    ready();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save & close" }));
    });
    const oldRequest = saveRequests[0]!;
    act(() => {
      vi.advanceTimersByTime(45_001);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "has not confirmed this save",
    );
    expect(frame()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Save & close" }),
    ).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save & close" }));
    });
    expect(saveRequests).toHaveLength(2);
    expect(saveRequests[1]).not.toBe(oldRequest);
    committedReceipts.add(oldRequest);
    message("Action_Save_Resp", { success: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(onClose).not.toHaveBeenCalled();
    committedReceipts.add(saveRequests[1]!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renews an expiring token inside the existing iframe", async () => {
    await start();
    const editorFrame = frame();
    const post = vi.spyOn(editorFrame.contentWindow!, "postMessage");
    ready();
    const refreshed = {
      ...session,
      accessToken: "renewed-secret",
      accessTokenTtl: Date.now() + 8_000_000,
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(refreshed)),
    );
    message("App_TokenExpiring", { Timeout: 120_000 });
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('"MessageId":"Reset_Access_Token"'),
        "https://office.example.com",
      ),
    );
    expect(frame()).toBe(editorFrame);
    expect(submissions).toHaveLength(1);
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('"token":"renewed-secret"'),
      "https://office.example.com",
    );
  });

  it("preserves the document when renewal fails", async () => {
    await start();
    ready();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Sign in again." }), {
        status: 401,
      }),
    );
    message("App_TokenExpired");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Session renewal failed",
    );
    expect(frame()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("respects read-only sessions and closes without issuing a save", async () => {
    session.mode = "view";
    await start();
    const post = vi.spyOn(frame().contentWindow!, "postMessage");
    ready();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      post.mock.calls.some(([payload]) =>
        String(payload).includes('"MessageId":"Action_Save"'),
      ),
    ).toBe(false);
  });

  it("prevents closing an editable session while offline", async () => {
    await start();
    ready();
    act(() => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: false,
      });
      window.dispatchEvent(new Event("offline"));
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & close" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen
        .getAllByRole("alert")
        .some((node) => node.textContent?.includes("Keep the editor open")),
    ).toBe(true);
  });
  it("does not replace an editing token when write access is revoked", async () => {
    await start();
    ready();
    const editorFrame = frame();
    const post = vi.spyOn(editorFrame.contentWindow!, "postMessage");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...session,
          mode: "view",
          accessToken: "read-only-token",
        }),
      ),
    );
    message("App_TokenExpiring", { Timeout: 120_000 });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "permissions changed",
    );
    expect(frame()).toBe(editorFrame);
    expect(
      post.mock.calls.some(
        ([payload]) =>
          typeof payload === "string" && payload.includes("Reset_Access_Token"),
      ),
    ).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation to leave after a definitive save failure", async () => {
    await start();
    ready();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Storage unavailable" }), {
        status: 503,
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save & close" }));
    });
    confirmation.mockResolvedValueOnce(false);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Close without saving" }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(frame()).toBeInTheDocument();
    confirmation.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Close without saving" }),
      );
    });
    expect(confirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Close without saving?",
        destructive: true,
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("retains the navigation guard when core autosave clears its local modified flag before storage is confirmed", async () => {
    await start();
    ready();
    message("Doc_ModifiedStatus", { Modified: true });
    message("Doc_ModifiedStatus", { Modified: false });
    expect(screen.getByText("Changes pending")).toBeInTheDocument();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
