// @vitest-environment node
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentEditorConfig } from "./editor-config";
import { getEditorDiscoveryXml } from "./editor-discovery";
import { verifyWopiProof } from "./wopi-proof";

vi.mock("./editor-discovery", () => ({ getEditorDiscoveryXml: vi.fn() }));

const current = generateKeyPairSync("rsa", { modulusLength: 2048 });
const old = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config: DocumentEditorConfig = {
  collaboraUrl: new URL("https://editor.example.test"),
  publicUrl: new URL("https://foreman.example.test"),
  secret: "test-signing-secret-unused-for-proof-verification",
};
const token = "test-token-with-utf8-é-and-漢";
const path = "/api/wopi/files/abc/contents?access_token=abc%2Bdef&tag=cAsE";
const externalUrl = `${config.publicUrl.origin}${path}`;

function attrs(key: KeyObject, prefix = "") {
  const jwk = key.export({ format: "jwk" });
  return `${prefix}modulus="${Buffer.from(jwk.n!, "base64url").toString("base64")}" ${prefix}exponent="${Buffer.from(jwk.e!, "base64url").toString("base64")}"`;
}
function discovery(
  currentKey = current.publicKey,
  oldKey: KeyObject | null = old.publicKey,
) {
  return `<wopi-discovery><proof-key ${attrs(currentKey)} ${oldKey ? attrs(oldKey, "old") : ""} /></wopi-discovery>`;
}
function ticks(offsetMs = 0) {
  return BigInt(Date.now() + offsetMs) * 10_000n + 621355968000000000n;
}

// Independent encoding of the protocol's unsigned lengths and big-endian ticks.
function signature(
  key: KeyObject,
  url = externalUrl,
  timestamp = ticks(),
  accessToken = token,
) {
  const encoder = new TextEncoder();
  const tokenBytes = encoder.encode(accessToken);
  const urlBytes = encoder.encode(url.toUpperCase());
  const bytes = new Uint8Array(
    4 + tokenBytes.length + 4 + urlBytes.length + 4 + 8,
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(0, tokenBytes.length);
  bytes.set(tokenBytes, 4);
  const urlOffset = 4 + tokenBytes.length;
  view.setUint32(urlOffset, urlBytes.length);
  bytes.set(urlBytes, urlOffset + 4);
  view.setUint32(urlOffset + 4 + urlBytes.length, 8);
  view.setBigInt64(urlOffset + 8 + urlBytes.length, timestamp);
  return sign("RSA-SHA256", bytes, key).toString("base64");
}
function request(overrides: Record<string, string> = {}, url = externalUrl) {
  return new Request(url, {
    headers: {
      "X-WOPI-TimeStamp": ticks().toString(),
      "X-WOPI-Proof": signature(current.privateKey),
      ...overrides,
    },
  });
}
async function rejects(input: Request, accessToken = token) {
  await expect(
    verifyWopiProof(input, accessToken, config),
  ).rejects.toMatchObject({
    code: "UNAUTHORIZED",
    message: "The document editor request could not be verified.",
  });
}

let testCount = 0;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 7, 12, testCount++)));
  vi.mocked(getEditorDiscoveryXml).mockReset().mockResolvedValue(discovery());
});
afterEach(() => vi.useRealTimers());

describe("WOPI RSA proof verification", () => {
  it("accepts a SHA256/RSA signature including UTF-8 token, uppercase URL and timestamp", async () => {
    await expect(
      verifyWopiProof(request(), token, config),
    ).resolves.toBeUndefined();
  });

  it("uses the public origin behind TLS termination and ignores spoofed forwarding headers", async () => {
    await expect(
      verifyWopiProof(
        request(
          {
            "x-forwarded-host": "attacker.example.test",
            "x-forwarded-proto": "http",
          },
          `http://127.0.0.1:3000${path}`,
        ),
        token,
        config,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts old header signed by current discovery key during rotation", async () => {
    await expect(
      verifyWopiProof(
        request({
          "X-WOPI-Proof": "invalid",
          "X-WOPI-ProofOld": signature(current.privateKey),
        }),
        token,
        config,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts current header signed by old discovery key during rotation", async () => {
    await expect(
      verifyWopiProof(
        request({ "X-WOPI-Proof": signature(old.privateKey) }),
        token,
        config,
      ),
    ).resolves.toBeUndefined();
  });

  it("does not accept old header signed by old key", async () => {
    await rejects(
      request({
        "X-WOPI-Proof": "invalid",
        "X-WOPI-ProofOld": signature(old.privateKey),
      }),
    );
  });

  it("does not require an old discovery key for a newly installed service", async () => {
    vi.mocked(getEditorDiscoveryXml).mockResolvedValue(
      discovery(current.publicKey, null),
    );
    await expect(
      verifyWopiProof(request(), token, config),
    ).resolves.toBeUndefined();
  });

  it("re-fetches discovery once when the trusted service rotates keys", async () => {
    vi.mocked(getEditorDiscoveryXml)
      .mockResolvedValueOnce(discovery(old.publicKey, null))
      .mockResolvedValue(discovery());
    await expect(
      verifyWopiProof(request(), token, config),
    ).resolves.toBeUndefined();
    expect(getEditorDiscoveryXml).toHaveBeenLastCalledWith(config, true);
  });

  it("limits forced refreshes for invalid signatures", async () => {
    vi.mocked(getEditorDiscoveryXml).mockResolvedValue(
      discovery(current.publicKey, null),
    );
    await rejects(request({ "X-WOPI-Proof": signature(old.privateKey) }));
    await rejects(request({ "X-WOPI-Proof": signature(old.privateKey) }));
    expect(
      vi
        .mocked(getEditorDiscoveryXml)
        .mock.calls.filter((call) => call[1] === true),
    ).toHaveLength(1);
  });

  it("rejects token substitution", async () => {
    await rejects(request(), "different-token");
  });
  it("rejects query modification without decoding or reordering the URL", async () => {
    await rejects(
      request({}, externalUrl.replace("tag=cAsE", "tag=different")),
    );
  });
  it("rejects signatures over an attacker-controlled host", async () => {
    await rejects(
      request({
        "X-WOPI-Proof": signature(
          current.privateKey,
          `https://attacker.example.test${path}`,
        ),
      }),
    );
  });
  it("rejects stale signed requests", async () => {
    const stamp = ticks(-20 * 60_000 - 1);
    await rejects(
      request({
        "X-WOPI-TimeStamp": stamp.toString(),
        "X-WOPI-Proof": signature(current.privateKey, externalUrl, stamp),
      }),
    );
    expect(getEditorDiscoveryXml).not.toHaveBeenCalled();
  });
  it("rejects a signed timestamp too far in the future", async () => {
    const stamp = ticks(20 * 60_000 + 1);
    await rejects(
      request({
        "X-WOPI-TimeStamp": stamp.toString(),
        "X-WOPI-Proof": signature(current.privateKey, externalUrl, stamp),
      }),
    );
  });
  it.each([
    "-1",
    "1e18",
    "9999999999999999999",
    "0",
    "",
    `${ticks()},${ticks()}`,
  ])("rejects malformed timestamp %s", async (stamp) => {
    await rejects(request({ "X-WOPI-TimeStamp": stamp }));
    expect(getEditorDiscoveryXml).not.toHaveBeenCalled();
  });
  it.each(["", "not/base64!", "A".repeat(2049)])(
    "rejects missing or malformed proof",
    async (proof) => {
      await rejects(request({ "X-WOPI-Proof": proof }));
      expect(getEditorDiscoveryXml).not.toHaveBeenCalled();
    },
  );
  it("rejects a missing primary header even when old proof is valid", async () => {
    await rejects(
      request({
        "X-WOPI-Proof": "",
        "X-WOPI-ProofOld": signature(current.privateKey),
      }),
    );
  });
  it.each([
    "<wopi-discovery />",
    `<wopi-discovery><proof-key modulus="AQAB" exponent="AQAB" /></wopi-discovery>`,
    `<wopi-discovery><proof-key ${attrs(current.publicKey)} oldmodulus="AQAB" /></wopi-discovery>`,
    `<wopi-discovery><proof-key ${attrs(current.publicKey)} modulus="AQAB" /></wopi-discovery>`,
    `<wopi-discovery><proof-key ${attrs(current.publicKey)} /><proof-key ${attrs(current.publicKey)} /></wopi-discovery>`,
    `<!DOCTYPE doc [<!ENTITY ex SYSTEM "file:///etc/passwd">]>${discovery()}`,
    "x".repeat(2 * 1024 * 1024 + 1),
  ])("fails closed when discovery has no usable proof key", async (xml) => {
    vi.mocked(getEditorDiscoveryXml).mockResolvedValue(xml);
    await rejects(request());
  });
  it("ignores commented proof keys", async () => {
    vi.mocked(getEditorDiscoveryXml).mockResolvedValue(
      `<!-- <proof-key ${attrs(old.publicKey)} /> -->${discovery()}`,
    );
    await expect(
      verifyWopiProof(request(), token, config),
    ).resolves.toBeUndefined();
  });
  it("hides discovery failure details and token values", async () => {
    vi.mocked(getEditorDiscoveryXml).mockRejectedValue(
      new Error(`private failure ${token}`),
    );
    await rejects(request());
  });
});
