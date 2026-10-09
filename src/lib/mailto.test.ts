import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEmailComposeUrl, openEmailCompose } from "./mailto";

describe("mailto", () => {
  it("builds default mail links without plus-encoding spaces", () => {
    const url = buildEmailComposeUrl({
      to: ["orders@example.com"],
      cc: ["buyer@example.com"],
      subject: "Order 123 ready",
      body: "Line one\nLine two",
    });

    expect(url).toBe(
      "mailto:orders@example.com?subject=Order%20123%20ready&body=Line%20one%0ALine%20two&cc=buyer%40example.com",
    );
  });

  it("builds Gmail compose links", () => {
    const url = buildEmailComposeUrl({
      to: ["orders@example.com"],
      subject: "Pipe order",
      body: "2 x pipe",
      client: "gmail",
    });

    expect(url).toBe(
      "https://mail.google.com/mail/?view=cm&fs=1&to=orders%40example.com&su=Pipe%20order&body=2%20x%20pipe",
    );
  });

  it("builds Outlook web compose links", () => {
    const url = buildEmailComposeUrl({
      to: ["orders@example.com"],
      cc: ["buyer@example.com"],
      subject: "Pipe order",
      body: "2 x pipe",
      client: "outlook",
    });

    expect(url).toBe(
      "https://outlook.office.com/mail/deeplink/compose?to=orders%40example.com&cc=buyer%40example.com&subject=Pipe%20order&body=2%20x%20pipe",
    );
  });
});

describe("email client launch", () => {
  beforeEach(() =>
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      clear: vi.fn(),
    }),
  );
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it.each(["default", "gmail", "outlook"] as const)(
    "opens %s synchronously without a delayed popup",
    (client) => {
      const spy = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(function (this: HTMLAnchorElement) {
          expect(this.isConnected).toBe(true);
          expect(this.target).toBe(client === "default" ? "_self" : "_blank");
          expect(this.rel).toBe("noopener noreferrer");
          expect(this.href).toBe(
            buildEmailComposeUrl({
              to: ["orders@example.com"],
              subject: "Order",
              body: "A\nB",
              client,
            }),
          );
        });
      const popup = vi.spyOn(window, "open");
      openEmailCompose({
        to: ["orders@example.com"],
        subject: "Order",
        body: "A\nB",
        client,
      });
      expect(spy).toHaveBeenCalledOnce();
      expect(popup).not.toHaveBeenCalled();
      expect(document.querySelector("a[hidden]")).toBeNull();
    },
  );
  it("falls back to native email when Safari blocks preference storage", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    const spy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.href.startsWith("mailto:")).toBe(true);
      });
    expect(() =>
      openEmailCompose({
        to: ["orders@example.com"],
        subject: "Order",
        body: "Body",
      }),
    ).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
  });
});
