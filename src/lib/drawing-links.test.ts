import { describe, expect, it } from "vitest";
import {
  drawingLinkSchema,
  drawingMarkupSchema,
  drawingMarkupLinkSchema,
  type DrawingMarkup,
  type DrawingJobSheet,
} from "./drawing-workspace";
import {
  drawingMarkupLinks,
  drawingLinkHref,
  MAX_DRAWING_LINKS,
} from "./drawing-links";

const id = "0391aed4-7773-47ec-9141-09df373ec008";
const markup: DrawingMarkup = {
  type: "link",
  sourceSheetId: id,
  points: [
    { x: 0.1, y: 0.2 },
    { x: 0.2, y: 0.3 },
  ],
  stroke: "#facc15",
  width: 2,
};
describe("drawing hyperlink destinations", () => {
  it.each([
    "https://example.com/manual",
    "http://example.com",
    "mailto:service@example.com",
    "tel:+14165550123",
    "/dashboard/jobs/abc/chat",
    "/dashboard/material-lists/abc",
    `/api/job-chat/attachments/${id}`,
  ])("accepts supported address %s", (value) =>
    expect(drawingLinkSchema.safeParse(value).success).toBe(true),
  );
  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "//example.com",
    "https://user:pass@example.com",
    "/dashboard/../api/private",
    "/dashboard/%2e%2e/private",
    "/dashboard\\evil",
    "/api/private",
    "https://example.com/\nscript",
  ])("rejects unsafe address %s", (value) =>
    expect(drawingLinkSchema.safeParse(value).success).toBe(false),
  );
  it("retains legacy destinations but treats a new list as authoritative", () => {
    expect(
      drawingMarkupLinks({
        ...markup,
        href: "https://example.com",
        text: "Manual",
      }),
    ).toEqual([{ label: "Manual", url: "https://example.com" }]);
    expect(drawingMarkupLinks({ ...markup, targetSheetId: id })).toEqual([
      { label: "Drawing sheet", targetSheetId: id },
    ]);
    const links = [{ label: "Chat", url: "/dashboard/jobs/abc/chat" }];
    expect(
      drawingMarkupLinks({ ...markup, href: "https://old.example", links }),
    ).toEqual(links);
  });
  it("requires named destinations with exactly one URL or sheet", () => {
    for (const link of [
      { label: "", url: "https://example.com" },
      { label: "No destination" },
      { label: "Ambiguous", url: "https://example.com", targetSheetId: id },
    ])
      expect(drawingMarkupLinkSchema.safeParse(link).success).toBe(false);
    expect(
      drawingMarkupSchema.safeParse({ ...markup, links: [] }).success,
    ).toBe(false);
    const links = Array.from({ length: MAX_DRAWING_LINKS }, (_, index) => ({
      label: `Manual ${index}`,
      url: `https://example.com/${index}`,
    }));
    expect(
      drawingMarkupSchema.parse({
        ...markup,
        links,
        linkAppearance: "highlight",
      }).links,
    ).toEqual(links);
    expect(
      drawingMarkupSchema.safeParse({ ...markup, links: [...links, links[0]] })
        .success,
    ).toBe(false);
  });
  it("resolves sheet links to their folder and rejects missing or unsafe targets", () => {
    const sheets = [{ id, setId: "folder" }] as DrawingJobSheet[];
    expect(
      drawingLinkHref({ label: "Drawing", targetSheetId: id }, "job", sheets),
    ).toBe(`/dashboard/jobs/job/drawings?drawingSet=folder&drawingSheet=${id}`);
    expect(
      drawingLinkHref({ label: "Drawing", targetSheetId: id }, "job", []),
    ).toBeNull();
    expect(
      drawingLinkHref(
        { label: "Unsafe", url: "javascript:alert(1)" },
        "job",
        [],
      ),
    ).toBeNull();
  });
});
