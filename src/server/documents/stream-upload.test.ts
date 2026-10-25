// @vitest-environment node
import { afterAll, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { access, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
const root = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  return (process.env.JOB_DOCUMENT_STORAGE_ROOT = mkdtempSync(
    path.join(tmpdir(), "upload-stream-test-"),
  ));
});
import { receiveDocumentUpload } from "./stream-upload";
import { documentBlobPath, MAX_DOCUMENT_FILE_BYTES } from "./storage";
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
const org = crypto.randomUUID();
function request(form: FormData) {
  return new Request("https://example.test/upload", {
    method: "POST",
    body: form,
  });
}
function form(bytes = "%PDF-1.7\nhello") {
  const form = new FormData();
  form.append("file", new Blob([bytes]), "Ä spec.pdf");
  form.append("folderId", "folder");
  return form;
}
it("stages and hashes chunks, publishes immutably only on request, then cleans staging", async () => {
  const bytes = "%PDF-1.7\nhello",
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const staged = await receiveDocumentUpload(request(form(bytes)), org);
  expect(staged).toMatchObject({
    name: "Ä spec.pdf",
    size: Buffer.byteLength(bytes),
    sha256,
  });
  expect(staged.fields.get("folderId")).toBe("folder");
  expect(staged.header.toString()).toBe(bytes);
  await expect(access(documentBlobPath(org, sha256))).rejects.toThrow();
  await staged.publish();
  await staged.publish();
  await staged.dispose();
  expect(await readFile(documentBlobPath(org, sha256), "utf8")).toBe(bytes);
  expect(await readdir(path.join(root, org, ".incoming"))).toEqual([]);
});
it("rejects duplicate files, duplicate/truncated fields, missing/empty files and malformed bodies without remnants", async () => {
  const duplicate = form();
  duplicate.append("file", new Blob(["x"]), "other");
  const duplicateField = form();
  duplicateField.append("folderId", "other");
  const longField = form();
  longField.append("metadata", "x".repeat(65537));
  const empty = form("");
  for (const body of [
    duplicate,
    duplicateField,
    longField,
    empty,
    new FormData(),
  ])
    await expect(receiveDocumentUpload(request(body), org)).rejects.toThrow();
  await expect(
    receiveDocumentUpload(
      new Request("https://example.test/upload", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=bad" },
        body: "--bad\r\n",
      }),
      org,
    ),
  ).rejects.toThrow();
  expect(await readdir(path.join(root, org, ".incoming"))).toEqual([]);
});
function streamedFile(size: number) {
  const boundary = "test-boundary";
  let remaining = size,
    step = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (step++ === 0) {
        controller.enqueue(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
          ),
        );
        return;
      }
      if (remaining) {
        const count = Math.min(65536, remaining);
        controller.enqueue(Buffer.alloc(count, 65));
        remaining -= count;
        return;
      }
      controller.enqueue(Buffer.from(`\r\n--${boundary}--\r\n`));
      controller.close();
    },
  });
  return new Request("https://example.test/upload", {
    method: "POST",
    body,
    duplex: "half",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  } as RequestInit);
}
it("accepts exactly 50 MB streamed and rejects one additional byte, including undeclared lengths", async () => {
  const staged = await receiveDocumentUpload(
    streamedFile(MAX_DOCUMENT_FILE_BYTES),
    org,
  );
  expect(staged.size).toBe(MAX_DOCUMENT_FILE_BYTES);
  await staged.dispose();
  await expect(
    receiveDocumentUpload(streamedFile(MAX_DOCUMENT_FILE_BYTES + 1), org),
  ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  expect(await readdir(path.join(root, org, ".incoming"))).toEqual([]);
}, 15_000);

it("cancels an interrupted stream and removes the partial file", async () => {
  const controller=new AbortController();
  let sent=false;
  const body=new ReadableStream<Uint8Array>({pull(stream){
    if(!sent){sent=true;stream.enqueue(Buffer.from('--cancel\r\nContent-Disposition: form-data; name="file"; filename="partial.pdf"\r\n\r\npartial'));}
  }});
  const request=new Request("https://example.test/upload",{method:"POST",body,duplex:"half",signal:controller.signal,headers:{"content-type":"multipart/form-data; boundary=cancel"}} as RequestInit);
  const received=receiveDocumentUpload(request,org);
  const rejected=expect(received).rejects.toThrow("interrupted");
  await vi.waitFor(()=>expect(sent).toBe(true));
  controller.abort();
  await rejected;
  expect(await readdir(path.join(root,org,".incoming"))).toEqual([]);
});
