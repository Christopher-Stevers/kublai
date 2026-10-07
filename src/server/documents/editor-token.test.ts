// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  editorRequestToken,
  EDITOR_TOKEN_LIFETIME_MS,
  issueEditorToken,
  verifyEditorToken,
  type EditorTokenScope,
} from "./editor-token";
import {
  documentEditorStatus,
  editorExtension,
  getDocumentEditorConfig,
  type DocumentEditorConfig,
} from "./editor-config";
const config: DocumentEditorConfig = {
  publicUrl: new URL("https://app.example.com"),
  collaboraUrl: new URL("https://office.example.com/office"),
  secret: "test-only-secret-".repeat(4),
};
const scope: EditorTokenScope = {
  organizationId: randomUUID(),
  jobId: randomUUID(),
  documentId: randomUUID(),
  userId: "user-a",
  mode: "edit",
  extension: "docx",
};
afterEach(() => vi.unstubAllEnvs());
describe("Scoped expiring editor tokens", () => {
  it("verifies only the exact file, job, configured audience, signature and expiration", () => {
    const now = Date.now();
    const issued = issueEditorToken(config, scope, now);
    expect(
      verifyEditorToken(config, issued.accessToken, scope, now),
    ).toMatchObject(scope);
    expect(issued.accessTokenTtl).toBe(now + EDITOR_TOKEN_LIFETIME_MS);
    expect(() =>
      verifyEditorToken(
        config,
        issued.accessToken,
        { ...scope, documentId: randomUUID() },
        now,
      ),
    ).toThrow();
    expect(() =>
      verifyEditorToken(
        config,
        issued.accessToken,
        { ...scope, jobId: randomUUID() },
        now,
      ),
    ).toThrow();
    expect(() =>
      verifyEditorToken(
        { ...config, secret: "wrong" },
        issued.accessToken,
        scope,
        now,
      ),
    ).toThrow();
    expect(() =>
      verifyEditorToken(
        { ...config, publicUrl: new URL("https://other.example.com") },
        issued.accessToken,
        scope,
        now,
      ),
    ).toThrow();
    expect(() =>
      verifyEditorToken(
        config,
        issued.accessToken,
        scope,
        issued.accessTokenTtl,
      ),
    ).toThrow();
    expect(() =>
      verifyEditorToken(config, issued.accessToken, scope, now - 31_000),
    ).toThrow();
  });
  it("retains view-only permission across mint and renewal without stable nonce reuse", () => {
    const first = issueEditorToken(config, { ...scope, mode: "view" });
    const next = issueEditorToken(config, { ...scope, mode: "view" });
    expect(first.accessToken).not.toBe(next.accessToken);
    expect(verifyEditorToken(config, first.accessToken, scope).mode).toBe(
      "view",
    );
    expect(() =>
      verifyEditorToken(
        config,
        `${first.accessToken.slice(0, -5)}xxxxx`,
        scope,
      ),
    ).toThrow();
  });
  it("accepts one consistent query or bearer token and rejects ambiguous inputs", () => {
    expect(
      editorRequestToken(
        new Request("https://app.example.com/wopi?access_token=one"),
      ),
    ).toBe("one");
    expect(
      editorRequestToken(
        new Request("https://app.example.com/wopi", {
          headers: { authorization: "Bearer two" },
        }),
      ),
    ).toBe("two");
    expect(() =>
      editorRequestToken(
        new Request(
          "https://app.example.com/wopi?access_token=one&access_token=two",
        ),
      ),
    ).toThrow();
    expect(() =>
      editorRequestToken(
        new Request("https://app.example.com/wopi?access_token=one", {
          headers: { authorization: "Bearer two" },
        }),
      ),
    ).toThrow();
    expect(() =>
      editorRequestToken(new Request("https://app.example.com/wopi")),
    ).toThrow();
  });
});
describe("Editor configuration", () => {
  it("rejects missing credentials, noncanonical app URLs and unsafe provider URLs", () => {
    vi.stubEnv("DOCUMENT_EDITOR_SECRET", config.secret);
    vi.stubEnv("COLLABORA_URL", config.collaboraUrl.href);
    vi.stubEnv("FOREMANHQ_PUBLIC_URL", config.publicUrl.href);
    expect(documentEditorStatus().configured).toBe(true);
    expect(getDocumentEditorConfig().collaboraUrl.pathname).toBe("/office");
    vi.stubEnv("FOREMANHQ_PUBLIC_URL", "https://app.example.com/callback?x=y");
    expect(documentEditorStatus().configured).toBe(false);
    vi.stubEnv("FOREMANHQ_PUBLIC_URL", config.publicUrl.href);
    vi.stubEnv("COLLABORA_URL", "https://user:password@office.example.com");
    expect(documentEditorStatus().configured).toBe(false);
    vi.stubEnv("COLLABORA_URL", "http://remote.example.com");
    expect(documentEditorStatus().configured).toBe(false);
    vi.stubEnv("COLLABORA_URL", config.collaboraUrl.href);
    vi.stubEnv("DOCUMENT_EDITOR_SECRET", "weak");
    expect(documentEditorStatus().configured).toBe(false);
  });
  it("allows only the explicitly supported editable format extensions", () => {
    expect(editorExtension("Report.DOCX")).toBe("docx");
    expect(editorExtension("Schedule.ods")).toBe("ods");
    for (const name of [
      "macro.docm",
      "legacy.doc",
      "file.pdf",
      "sheet.csv",
      "report.docx.exe",
    ])
      expect(editorExtension(name)).toBeNull();
  });
});
