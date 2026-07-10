import { describe, expect, it } from "vitest";
import { buildEmailComposeUrl } from "./mailto";

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
