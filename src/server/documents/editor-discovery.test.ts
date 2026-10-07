// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverEditorAction,
  getEditorDiscoveryXml,
  parseEditorDiscovery,
} from "./editor-discovery";
import type { DocumentEditorConfig } from "./editor-config";
const config: DocumentEditorConfig = {
  publicUrl: new URL("https://app.example.com"),
  collaboraUrl: new URL("https://office.example.com/office"),
  secret: "test-only-secret-".repeat(4),
};
const wopi = "https://app.example.com/api/job-documents/wopi/file?jobId=job";
const discovery = `<wopi-discovery><net-zone><app name="writer"><action name="edit" ext="docx" urlsrc="https://office.example.com/office/browser/token/cool.html?&lt;ui=UI_LLCC&amp;&gt;"/></app></net-zone></wopi-discovery>`;
afterEach(() => vi.unstubAllGlobals());
describe("Configured-only editor discovery", () => {
  it("extracts same-origin action and passes stable WOPI identity without tokens", () => {
    const url = new URL(
      parseEditorDiscovery(discovery, config, "docx", "edit", wopi),
    );
    expect(url.origin).toBe(config.collaboraUrl.origin);
    expect(url.searchParams.get("WOPISrc")).toBe(wopi);
    expect(url.searchParams.get("permission")).toBe("edit");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(url.href).not.toContain("UI_LLCC");
    expect(
      new URL(
        parseEditorDiscovery(discovery, config, "docx", "view", wopi),
      ).searchParams.get("permission"),
    ).toBe("readonly");
  });
  it("rejects cross-origin targets, credentials, unsupported formats and DTD expansion", () => {
    expect(() =>
      parseEditorDiscovery(
        discovery.replace(
          "https://office.example.com",
          "https://attacker.example.com",
        ),
        config,
        "docx",
        "edit",
        wopi,
      ),
    ).toThrow();
    expect(() =>
      parseEditorDiscovery(
        discovery.replace(
          "https://office.example.com",
          "https://user:password@office.example.com",
        ),
        config,
        "docx",
        "edit",
        wopi,
      ),
    ).toThrow();
    expect(() =>
      parseEditorDiscovery(discovery, config, "xlsx", "edit", wopi),
    ).toThrow();
    expect(() =>
      parseEditorDiscovery(
        `<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>${discovery}`,
        config,
        "docx",
        "edit",
        wopi,
      ),
    ).toThrow();
  });
  it("fetches only configured prefix and refuses redirects without client-controlled URLs", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(discovery, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await getEditorDiscoveryXml(config, true);
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://office.example.com/office/hosting/discovery"),
      expect.objectContaining({ redirect: "error", cache: "no-store" }),
    );
    await discoverEditorAction(config, "docx", "edit", wopi);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockRejectedValue(new Error("redirect refused"));
    await expect(getEditorDiscoveryXml(config, true)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});
