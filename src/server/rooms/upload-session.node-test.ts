import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendChunk,
  assertOwner,
  boundedBody,
  CHUNK_BYTES,
  createUpload,
  readSession,
  reserveWorker,
  sessionDir,
  UPLOAD_BYTES,
} from "./upload-session";
import { readUploadResponse } from "../../lib/upload-drawings";

const jobId = "0391aed4-7773-47ec-9141-09df373ec008";
const owner = { userId: "test-user", organizationId: "test-org" };
const request = (body: string) =>
  new Request("http://localhost/upload", { method: "POST", body });

test("bounded resumable upload protocol (isolated temporary disk, no database)", async (t) => {
  const cwd = process.cwd();
  const temp = await mkdtemp(path.join(os.tmpdir(), "upload-protocol-test-"));
  process.chdir(temp);
  try {
    await t.test(
      "100 MB accepted, 100 MB + 1 rejected before staging",
      async () => {
        await assert.rejects(
          createUpload(
            { jobId, filename: "oversize.pdf", size: UPLOAD_BYTES + 1 },
            owner,
          ),
          /100 MB/,
        );
        const s = await createUpload(
          { jobId, filename: "large.pdf", size: UPLOAD_BYTES },
          { ...owner, userId: "large-test" },
        );
        assert.equal(s.size, UPLOAD_BYTES);
      },
    );
    await t.test(
      "body limits apply without Content-Length and reject broken streams",
      async () => {
        await assert.rejects(boundedBody(request("123456"), 5), /too large/);
        const broken = new ReadableStream({
          start(c) {
            c.error(new Error("aborted"));
          },
        });
        await assert.rejects(
          boundedBody(
            new Request("http://localhost", {
              method: "POST",
              body: broken,
              duplex: "half",
            } as RequestInit),
            10,
          ),
          /interrupted/,
        );
        const declared = request("a");
        declared.headers.set("content-length", "100");
        await assert.rejects(boundedBody(declared, 5), /too large/);
      },
    );
    const s = await createUpload(
      { jobId, filename: "drawing.pdf", size: CHUNK_BYTES + 7 },
      owner,
    );
    await t.test(
      "lost init response resumes same upload instead of allocating another",
      async () => {
        const retried = await createUpload(
          { jobId, filename: "drawing.pdf", size: s.size },
          owner,
        );
        assert.equal(retried.id, s.id);
      },
    );
    await t.test("ownership and path traversal fail closed", () => {
      assert.throws(
        () => assertOwner(s, "someone-else", owner.organizationId),
        /not found/,
      );
      assert.throws(
        () => assertOwner(s, owner.userId, "other-org"),
        /not found/,
      );
      assert.throws(() => sessionDir("../plan.pdf"), /Invalid/);
    });
    const first = Buffer.alloc(CHUNK_BYTES, 65);
    first.write("%PDF-");
    await t.test("chunks are fixed-size, ordered and bounded", async () => {
      await assert.rejects(
        appendChunk(s.id, CHUNK_BYTES, Buffer.alloc(7)),
        /out of order/,
      );
      await assert.rejects(appendChunk(s.id, 0, Buffer.alloc(10)), /length/);
      const saved = await appendChunk(s.id, 0, first);
      assert.equal(saved.received, CHUNK_BYTES);
    });
    await t.test(
      "duplicate chunks are idempotent and mismatched retries are rejected",
      async () => {
        assert.equal((await appendChunk(s.id, 0, first)).received, CHUNK_BYTES);
        await assert.rejects(
          appendChunk(s.id, 0, Buffer.alloc(CHUNK_BYTES)),
          /differs/,
        );
      },
    );
    await t.test("final short chunk preserves exact file bytes", async () => {
      const end = Buffer.from("\n%%EOF\n");
      await appendChunk(s.id, CHUNK_BYTES, end);
      assert.equal((await readSession(s.id)).received, s.size);
      assert.deepEqual(
        await readFile(path.join(sessionDir(s.id), "upload.pdf")),
        Buffer.concat([first, end]),
      );
    });
    await t.test("global renderer concurrency is one", async () => {
      const release = await reserveWorker();
      await assert.rejects(reserveWorker(), /Another PDF/);
      await release();
      const second = await reserveWorker();
      await second();
    });
    await t.test(
      "empty 500, HTML 524 and malformed success never leak JSON parser errors",
      async () => {
        await assert.rejects(
          readUploadResponse(new Response(null, { status: 500 })),
          /HTTP 500.*empty/,
        );
        await assert.rejects(
          readUploadResponse(
            new Response("<html>Cloudflare</html>", {
              status: 524,
              headers: { "content-type": "text/html" },
            }),
          ),
          /HTTP 524/,
        );
        await assert.rejects(
          readUploadResponse(
            new Response("{", {
              headers: { "content-type": "application/json" },
            }),
          ),
          /HTTP 200/,
        );
        await assert.rejects(
          readUploadResponse(
            new Response("null", {
              headers: { "content-type": "application/json" },
            }),
          ),
          /HTTP 200/,
        );
      },
    );
    await t.test(
      "structured server errors and valid JSON survive parsing",
      async () => {
        await assert.rejects(
          readUploadResponse(
            Response.json({ error: "PDF over limit" }, { status: 413 }),
          ),
          /PDF over limit/,
        );
        assert.deepEqual(
          await readUploadResponse(
            Response.json({ status: "ready", floors: [] }),
          ),
          { status: "ready", floors: [] },
        );
      },
    );
  } finally {
    process.chdir(cwd);
    await rm(temp, { recursive: true, force: true });
  }
});
