// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  parseHyperlinkDetection,
  readHyperlinkVision,
} from "./hyperlink-vision";
const image = {
  png: Buffer.from("fixture"),
  left: 0.5,
  top: 0.5,
  right: 1,
  bottom: 1,
};
const box = { left: 0.2, top: 0.2, right: 0.4, bottom: 0.3 };
const output = { tags: [{ tag: "AHU1", image: 0, box }], warnings: [] };
afterEach(() => vi.unstubAllEnvs());
it("maps cropped image coordinates to the original drawing and snaps only to unambiguous text", () => {
  const result = parseHyperlinkDetection(output, "terra", [image], []);
  expect(result.tags[0]).toMatchObject({
    tag: "AHU-1",
    needsPositionReview: true,
    boxes: [{ left: 0.6, top: 0.6, right: 0.7, bottom: 0.65 }],
  });
  const word = {
    text: "AHU-1",
    left: 0.61,
    top: 0.61,
    right: 0.68,
    bottom: 0.64,
  };
  const anchored = parseHyperlinkDetection(output, "terra", [image], [word]);
  expect(anchored.tags[0]).toMatchObject({
    needsPositionReview: false,
    boxes: [word],
  });
});
it("deduplicates overlapping crops but retains separate occurrences of a tag", () => {
  const result = parseHyperlinkDetection(
    {
      tags: [
        output.tags[0],
        output.tags[0],
        {
          ...output.tags[0],
          box: { left: 0.7, top: 0.7, right: 0.8, bottom: 0.8 },
        },
      ],
      warnings: [],
    },
    "deepseek",
    [image],
    [],
  );
  expect(result.tags[0]?.boxes).toHaveLength(2);
});
it.each([
  { ...output.tags[0], image: 4 },
  { ...output.tags[0], box: { ...box, right: -1 } },
  { ...output.tags[0], box: { ...box, right: 0.1 } },
  { ...output.tags[0], tag: "https://evil.test/1" },
])(
  "rejects invented image references, invalid boxes and non-tag values",
  (item) => {
    expect(() =>
      parseHyperlinkDetection(
        { tags: [item], warnings: [] },
        "terra",
        [image],
        [],
      ),
    ).toThrow();
  },
);
it.each(["terra", "deepseek"] as const)(
  "sends images to the selected %s provider and validates its completed JSON response",
  async (reader) => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key");
    vi.stubEnv("DEEPSEEK_API_KEY", "fixture-key");
    const request = vi.fn(async () =>
      Response.json(
        reader === "terra"
          ? {
              status: "completed",
              output: [
                {
                  content: [
                    { type: "output_text", text: JSON.stringify(output) },
                  ],
                },
              ],
            }
          : {
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: JSON.stringify(output) },
                },
              ],
            },
      ),
    );
    const result = await readHyperlinkVision(
      reader,
      [image],
      [],
      ["AHU-1"],
      request,
    );
    expect(result.tags[0]?.tag).toBe("AHU-1");
    const [url, init] = request.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string) as {
      model: string;
      store?: boolean;
      response_format?: { type: string };
    };
    expect(url).toBe(
      reader === "terra"
        ? "https://api.openai.com/v1/responses"
        : "https://api.deepseek.com/chat/completions",
    );
    expect(body.model).toBe(
      reader === "terra" ? "gpt-6.1-terra" : "deepseek-flash",
    );
    expect(JSON.stringify(body)).toContain("data:image/png;base64,");
    if (reader === "terra") expect(body.store).toBe(false);
    else expect(body.response_format).toEqual({ type: "json_object" });
  },
);
it("does not call a provider without credentials or fall back after failure", async () => {
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  const request = vi.fn(async () => new Response("error", { status: 429 }));
  await expect(
    readHyperlinkVision("deepseek", [image], [], [], request),
  ).rejects.toThrow("not connected");
  expect(request).not.toHaveBeenCalled();
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture");
  await expect(
    readHyperlinkVision("deepseek", [image], [], [], request),
  ).rejects.toThrow("HTTP 429");
  expect(request).toHaveBeenCalledOnce();
});
it("rejects truncated model output and oversized responses", async () => {
  vi.stubEnv("OPENAI_API_KEY", "fixture");
  await expect(
    readHyperlinkVision("terra", [image], [], [], async () =>
      Response.json({ status: "incomplete", output: [] }),
    ),
  ).rejects.toThrow("did not finish");
  await expect(
    readHyperlinkVision(
      "terra",
      [image],
      [],
      [],
      async () => new Response("x".repeat(1024 * 1024 + 1)),
    ),
  ).rejects.toThrow("size limit");
});
it("accepts room, letter-only and sheet-qualified tags and snaps them to source text", () => {
  const words = ["101", "A", "1/M501", "VENT-A", "100-PL-001"].map((text, index) => ({text, left:.61, right:.68, top:.61+index*.001, bottom:.64+index*.001}));
  const result = parseHyperlinkDetection({tags: words.map(word => ({tag:word.text,image:0,box})),warnings:[]}, "terra", [image], words);
  expect(result.tags.map(row=>row.tag)).toEqual(["101","A","1/M-501","VENT-A","100-PL-001"]);
  expect(result.tags.every(row=>!row.needsPositionReview)).toBe(true);
});
