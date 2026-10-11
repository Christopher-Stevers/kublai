// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
vi.mock("./connection", () => ({
  readApsCredentials: vi.fn(async () => ({
    clientId: "test-client",
    clientSecret: "private-secret",
  })),
}));
import {
  trustedAutodeskDownload,
  ifcDerivative,
  startRevitTranslation,
  clearApsToken,
  readRevitTranslation,
} from "./translation";
afterEach(() => {
  vi.unstubAllGlobals();
  clearApsToken("org");
});
describe("Autodesk conversion protocol", () => {
  it("rejects arbitrary storage hosts, credentials in URLs, insecure and redirected addresses", () => {
    for (const url of [
      "http://cdn.derivative.autodesk.com/x",
      "https://evil.example/x",
      "https://user:pass@cdn.derivative.autodesk.com/x",
      "https://cdn.derivative.autodesk.com.evil.example/x",
      "https://cdn.derivative.autodesk.com:8000/x",
    ])
      expect(() => trustedAutodeskDownload(url)).toThrow();
    expect(
      trustedAutodeskDownload("https://cdn.derivative.autodesk.com/x").hostname,
    ).toBe("cdn.derivative.autodesk.com");
  });
  it("finds nested IFC output and reports terminal translation failures", async () => {
    expect(
      ifcDerivative({
        derivatives: [
          { outputType: "ifc", children: [{ urn: "urn:output/file.ifc" }] },
        ],
      }),
    ).toBe("urn:output/file.ifc");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).includes("/token")
          ? Response.json({ access_token: "secret-token", expires_in: 3600 })
          : Response.json({ status: "failed" }),
      ),
    );
    expect((await readRevitTranslation("org", "abc")).status).toBe("failed");
  });
  it("uploads more than 25 parts in batches, reuses uploadKey and keeps bearer tokens off S3", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "bim-aps-test-"));
    const file = path.join(dir, "a.rvt");
    const handle = await open(file, "w");
    await handle.truncate(210 * 1024 * 1024);
    await handle.close();
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init: RequestInit = {}) => {
        const u = String(url);
        calls.push({ url: u, init });
        if (u.includes("/token"))
          return Response.json({
            access_token: "secret-token",
            expires_in: 3600,
          });
        if (u.includes("signeds3upload?")) {
          const q = new URL(u).searchParams;
          return Response.json({
            uploadKey: "upload-key",
            urls: Array.from(
              { length: Number(q.get("parts")) },
              (_, i) =>
                `https://model.s3.us-east-1.amazonaws.com/${Number(q.get("firstPart")) + i}`,
            ),
          });
        }
        if (u.endsWith("signeds3upload"))
          return Response.json({ objectId: "urn:test" });
        return Response.json({});
      }),
    );
    try {
      expect(
        await startRevitTranslation("org", "model", file, 210 * 1024 * 1024),
      ).toBe(Buffer.from("urn:test").toString("base64url"));
      const signs = calls.filter((c) => c.url.includes("signeds3upload?"));
      expect(signs).toHaveLength(2);
      expect(new URL(signs[0]!.url).searchParams.get("parts")).toBe("25");
      expect(new URL(signs[1]!.url).searchParams.get("uploadKey")).toBe(
        "upload-key",
      );
      expect(
        calls.filter((c) => c.url.includes(".amazonaws.com")),
      ).toHaveLength(27);
      for (const c of calls.filter((c) => c.url.includes(".amazonaws.com")))
        expect(c.init.headers).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
