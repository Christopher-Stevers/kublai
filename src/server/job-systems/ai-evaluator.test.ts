// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvaluator } from "./ai-evaluator";
import { customEndpoint, customCompletion } from "./ai-transport";
const questions = {
  material: {
    type: "choice" as const,
    instructions: "Choose the specified material",
    criteria: { copper: "Copper", unclear: "Not specified" },
  },
};
const result = (choice = "copper", finish = "stop") => ({
  choices: [
    {
      finish_reason: finish,
      message: {
        content: JSON.stringify({
          answers: { material: { type: "choice", choice, confidence: 0.95 } },
        }),
      },
    },
  ],
});
afterEach(() => vi.unstubAllGlobals());
function hosted(response: unknown, model = "Qwen3.8-27B") {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: model }] })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(response)));
  vi.stubGlobal("fetch", mock);
  return mock;
}
describe("assessment LLM", () => {
  it("uses Qwen with bounded JSON output and no Jev request", async () => {
    const mock = hosted(result());
    expect(
      (await createEvaluator()({ text: "Copper" }, questions)).answers.material
        ?.choice,
    ).toBe("copper");
    expect(mock.mock.calls.map((c) => c[0] as string)).toEqual([
      "http://127.0.0.1:8082/v1/models",
      "http://127.0.0.1:8082/v1/chat/completions",
    ]);
    const body = JSON.parse(
      (mock.mock.calls[1]![1] as RequestInit).body as string,
    ) as { model: string; response_format: unknown; max_tokens: number };
    expect(body).toMatchObject({
      model: "Qwen3.8-27B",
      response_format: { type: "json_object" },
      max_tokens: 4096,
    });
  });
  it("refuses a different hosted model before sending evidence", async () => {
    const mock = hosted(result(), "Dolphin");
    await expect(
      createEvaluator()({ text: "private evidence" }, questions),
    ).rejects.toThrow("wrong model");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it.each([
    result("invented"),
    result("copper", "length"),
    { choices: [] },
    result("toString"),
  ])("rejects invalid or truncated outputs", async (output) => {
    hosted(output);
    await expect(createEvaluator()({}, questions)).rejects.toThrow(
      "invalid assessment",
    );
  });
  it("blocks excessive input before contacting a provider", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(
      createEvaluator()({ text: "x".repeat(60001) }, questions),
    ).rejects.toThrow("too large");
    expect(mock).not.toHaveBeenCalled();
  });
  it.each([
    "http://example.com/v1",
    "https://user:pass@example.com/v1",
    "https://example.com:8082/v1",
    "https://example.com/v1?key=secret",
  ])("rejects unsafe base URL %s", (base) => {
    expect(() => customEndpoint(base)).toThrow();
  });
  it("refuses loopback custom providers", async () => {
    await expect(
      customCompletion("https://127.0.0.1/v1", "secret", "{}"),
    ).rejects.toThrow("public internet");
  });
});
