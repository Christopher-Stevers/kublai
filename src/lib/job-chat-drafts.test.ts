import { File as NativeFile } from "node:buffer";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as DraftModule from "./job-chat-drafts";
import type { ChatDraft } from "./job-chat-drafts";

let drafts: typeof DraftModule;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  // jsdom's File cannot be structured-cloned by Node. Its native File can,
  // exercising IndexedDB's real structured-clone contract and byte retention.
  vi.stubGlobal("File", NativeFile);
  drafts = await import("./job-chat-drafts");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fileDraft(body = "Photo from site"): ChatDraft {
  const file = new File([new Uint8Array([0, 1, 255, 7, 9])], "site.png", {
    type: "image/png",
    lastModified: 12345,
  });
  return {
    clientId: "fixed-client-id",
    body,
    attachments: [
      {
        localId: "file-one",
        name: file.name,
        size: file.size,
        type: file.type,
        file,
      },
    ],
  };
}
async function storedFileKeys() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("foremanhq-job-chat-drafts", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error(request.error?.message ?? "IndexedDB request failed"));
  });
  try {
    return await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = db
        .transaction("files", "readonly")
        .objectStore("files")
        .getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error(request.error?.message ?? "IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

describe("durable chat drafts with IndexedDB", () => {
  it("loads the newest in-flight draft with exact File bytes, filename, MIME type and retry UUID", async () => {
    const original = {
      ...fileDraft(),
      attempted: true,
      replyToId: "parent-message",
    };
    const saving = drafts.saveChatDraft("user:job", original);
    // Deliberately do not await saving: reopening immediately must observe it.
    const restored = await drafts.loadChatDraft("user:job");
    await saving;
    expect(restored).toMatchObject({
      clientId: "fixed-client-id",
      body: original.body,
      attempted: true,
      replyToId: "parent-message",
    });
    const file = restored!.attachments[0]!.file!;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("site.png");
    expect(file.type).toBe("image/png");
    expect(file.lastModified).toBe(12345);
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([
      0, 1, 255, 7, 9,
    ]);
  });

  it("does not clone the attachment bytes again on every keystroke or retry metadata update", async () => {
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    const first = fileDraft("first");
    await Promise.all([
      drafts.saveChatDraft("user:job", first),
      drafts.saveChatDraft("user:job", { ...first, body: "second" }),
      drafts.saveChatDraft("user:job", {
        ...first,
        body: "third",
        attempted: true,
        attachments: [
          {
            ...first.attachments[0]!,
            uploaded: {
              id: "upload-id",
              name: "site.png",
              size: 5,
              mimeType: "image/png",
              url: "/api/job-chat/attachments/upload-id",
            },
          },
        ],
      }),
    ]);
    expect(
      put.mock.calls.filter((args) => args[0] instanceof File),
    ).toHaveLength(1);
    const restored = await drafts.loadChatDraft("user:job");
    expect(restored?.body).toBe("third");
    expect(restored?.attachments[0]?.uploaded?.id).toBe("upload-id");
    expect(restored?.attachments[0]?.file?.size).toBe(5);
  });

  it("serializes clearing after pending writes so a delivered draft cannot reappear", async () => {
    const original = fileDraft();
    const writes = Array.from({ length: 8 }, (_, index) =>
      drafts.saveChatDraft("user:job", {
        ...original,
        body: `revision ${index}`,
      }),
    );
    const cleared = drafts.saveChatDraft("user:job", null);
    expect(await drafts.loadChatDraft("user:job")).toBeNull();
    await Promise.all([...writes, cleared]);
    expect(await storedFileKeys()).toEqual([]);
  });

  it("preserves a new draft queued after clearing the delivered one", async () => {
    const old = drafts.saveChatDraft("user:job", fileDraft("delivered"));
    const clear = drafts.saveChatDraft("user:job", null);
    const next = drafts.saveChatDraft("user:job", {
      clientId: "next-message",
      body: "Keep this",
      attachments: [],
    });
    await Promise.all([old, clear, next]);
    expect(await drafts.loadChatDraft("user:job")).toMatchObject({
      clientId: "next-message",
      body: "Keep this",
    });
    expect(await storedFileKeys()).toEqual([]);
  });

  it("isolates accounts and jobs even when attachment local IDs coincide", async () => {
    await Promise.all([
      drafts.saveChatDraft("alice:job-one", fileDraft("Alice's first job")),
      drafts.saveChatDraft("bob:job-one", fileDraft("Bob's draft")),
      drafts.saveChatDraft("alice:job-two", fileDraft("Alice's other job")),
    ]);
    await drafts.saveChatDraft("alice:job-one", null);
    expect(await drafts.loadChatDraft("alice:job-one")).toBeNull();
    expect((await drafts.loadChatDraft("bob:job-one"))?.body).toBe(
      "Bob's draft",
    );
    expect((await drafts.loadChatDraft("alice:job-two"))?.body).toBe(
      "Alice's other job",
    );
    expect(await storedFileKeys()).toEqual([
      "alice:job-two:file-one",
      "bob:job-one:file-one",
    ]);
  });

  it("removes only the removed attachment's persisted bytes", async () => {
    const original = fileDraft();
    const second = {
      ...original.attachments[0]!,
      localId: "file-two",
      file: new File(["second"], "second.png", { type: "image/png" }),
    };
    await drafts.saveChatDraft("user:job", {
      ...original,
      attachments: [...original.attachments, second],
    });
    await drafts.saveChatDraft("user:job", {
      ...original,
      attachments: [second],
    });
    expect(await storedFileKeys()).toEqual(["user:job:file-two"]);
    expect(
      await (
        await drafts.loadChatDraft("user:job")
      )?.attachments[0]?.file?.text(),
    ).toBe("second");
  });
});
