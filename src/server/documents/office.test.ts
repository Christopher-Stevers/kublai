import { describe, expect, it } from "vitest";

import { officeFileKind, validateOfficeUrl } from "./office";

const guid = "12345678-1234-1234-1234-123456789abc";
const canonical = `https://builder.sharepoint.com/sites/Job/_layouts/15/Doc.aspx?sourcedoc=%7B${guid}%7D&file=Schedule.xlsx&action=edit`;

describe("validateOfficeUrl", () => {
  it("normalizes a canonical Microsoft file URL without changing editing permissions", () => {
    expect(
      validateOfficeUrl(
        `  ${canonical.replace("builder.sharepoint.com", "BUILDER.SHAREPOINT.COM:443")}  `,
      ),
    ).toBe(canonical);
  });

  it.each([
    "https://builder.sharepoint.com/sites/Job/Shared%20Documents/Scope.docx?web=1",
    "https://builder-my.sharepoint.com/:x:/g/personal/user_builder_com/EXAMPLE?e=abc123&csf=1&web=1",
    `https://builder.sharepoint.com/:w:/r/sites/Job/_layouts/15/Doc.aspx?sourcedoc=${guid}&file=Scope.docx&action=default&mobileredirect=true`,
    `https://builder.sharepoint.com/:w:r/contentstorage/CSP_123/_layouts/15/doc2.aspx?sourcedoc=${guid}&file=Scope.docx`,
    "https://onedrive.live.com/edit.aspx?resid=1234567890ABCDEF!123&cid=1234567890ABCDEF",
    "https://onedrive.live.com/?id=1234567890ABCDEF!sabcdef123&action=edit",
  ])("accepts supported file links: %s", (url) => {
    expect(new URL(validateOfficeUrl(url)).protocol).toBe("https:");
  });

  it.each([
    "https://builder.sharepoint.com.attacker.test/report.docx",
    "https://sharepoint.com/report.docx",
    "https://child.builder.sharepoint.com/report.docx",
    "https://builder.sharepoint.com./report.docx",
    "https://onedrive.live.com.attacker.test/edit.aspx?resid=1234567890ABCDEF!123",
    "https://builder.sharepoint.com@attacker.test/report.docx",
    "https://attacker@builder.sharepoint.com/report.docx",
    "https://user:secret@builder.sharepoint.com/report.docx",
    "https://builder.sharepoint.com:8443/report.docx",
    "http://builder.sharepoint.com/report.docx",
    "javascript:alert(1)",
    "//builder.sharepoint.com/report.docx",
    "https://1drv.ms/w/s!example",
    "https://office.com/launch/word",
    "https://view.officeapps.live.com/op/view.aspx?src=https://attacker.test/report.docx",
    "https://builder.sharepoint.com\\@attacker.test/report.docx",
    "https://builder.sharepoint.com/report%0a.docx",
    "https://builder.sharepoint.com/report%ZZ.docx",
    "https://builder.sharepoint.com/report.docx#access_token=secret",
  ])(
    "rejects unsupported hosts, unsafe input and non-file services: %s",
    (url) => {
      expect(() => validateOfficeUrl(url)).toThrow();
    },
  );

  it.each([
    "access_token=secret",
    "Access_Token=secret",
    "%61ccess_token=secret",
    "id_token=secret",
    "refresh_token=secret",
    "authkey=secret",
    "code=secret",
    "redirect_uri=https%3A%2F%2Fattacker.test",
    "returnUrl=https%3A%2F%2Fattacker.test",
    "e=https%3A%2F%2Fattacker.test",
    "web=1&WEB=0",
    "action=delete",
    "file=..%2Fsecret.xlsx",
    "sourcedoc=https%3A%2F%2Fattacker.test%2Freport.docx",
  ])(
    "rejects authentication, redirect and ambiguous query parameters: %s",
    (query) => {
      expect(() =>
        validateOfficeUrl(
          `https://builder.sharepoint.com/report.docx?${query}`,
        ),
      ).toThrow();
    },
  );

  it.each([
    "https://builder.sharepoint.com/",
    "https://builder.sharepoint.com/sites/Job",
    "https://builder.sharepoint.com/sites/Job/_layouts/15/Doc.aspx",
    "https://builder.sharepoint.com/:w:/r/sites/Job/_layouts/15/redirect.aspx?e=test",
    "https://builder.sharepoint.com/:f:/s/Job/EXAMPLE",
    "https://builder.sharepoint.com/sites/Job/report.pdf",
    "https://builder.sharepoint.com/sites/Job/report.constructor",
    "https://builder.sharepoint.com/sites/Job/report.__proto__",
    "https://onedrive.live.com/",
    "https://onedrive.live.com/edit.aspx?resid=https%3A%2F%2Fattacker.test",
    "https://onedrive.live.com/redir?resid=1234567890ABCDEF!123&authkey=secret",
  ])("requires a recognizable Office document target: %s", (url) => {
    expect(() => validateOfficeUrl(url)).toThrow();
  });
});

describe("officeFileKind", () => {
  it.each([
    ["Scope.DOCX", "word"],
    ["Costs.xlsx", "excel"],
    ["Kickoff.pptx", "powerpoint"],
    [canonical, "excel"],
    ["https://builder.sharepoint.com/:w:/s/Job/EXAMPLE", "word"],
    ["https://builder.sharepoint.com/:x:/s/Job/EXAMPLE", "excel"],
    [
      "https://builder.sharepoint.com/sites/Job/Shared%20Documents/Scope.docx",
      "word",
    ],
    ["Plan.pdf", null],
    ["Unknown", null],
    ["file.constructor", null],
    ["file.__proto__", null],
  ])("identifies %s only as a display hint", (input, expected) => {
    expect(officeFileKind(input)).toBe(expected);
  });
});
