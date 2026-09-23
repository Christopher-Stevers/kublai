// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { askJev, validateAnswers, type DecisionRequest } from "./jev";
const request: DecisionRequest = {
  state: { product: "Copper elbow" },
  questions: {
    match: {
      type: "choice",
      instructions: "Same product?",
      criteria: { same: "Same", different: "Different" },
    },
  },
};
const valid = () => ({
  model: "jev-test",
  answers: {
    match: {
      type: "choice",
      choice: "same",
      probabilities: { same: 0.9, different: 0.1 },
      confidence: 0.8,
    },
  },
});
afterEach(() => vi.unstubAllEnvs());
describe("Jev boundary", () => {
  it("accepts a documented Choice response", () => {
    expect(validateAnswers(valid(), request).answers.match?.choice).toBe(
      "same",
    );
  });
  it.each([
    { ...valid(), answers: {} },
    {
      ...valid(),
      answers: { match: { ...valid().answers.match, choice: "unknown" } },
    },
    {
      ...valid(),
      answers: { match: { ...valid().answers.match, confidence: 4 } },
    },
    {
      ...valid(),
      answers: {
        match: {
          ...valid().answers.match,
          probabilities: { same: 0.3, different: 0.7 },
        },
      },
    },
    {
      ...valid(),
      answers: {
        match: { ...valid().answers.match, probabilities: { same: 0.9 } },
      },
    },
    {
      ...valid(),
      answers: {
        match: {
          ...valid().answers.match,
          probabilities: { same: 0.9, different: 0.9 },
        },
      },
    },
  ])("rejects malformed or out-of-set answers", (body) => {
    expect(() => validateAnswers(body, request)).toThrow();
  });
  it("does not call the provider without credentials", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetcher = vi.fn();
    await expect(askJev(request, fetcher)).rejects.toThrow("not connected");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the documented endpoint, server secret and bounded request", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-secret");
    vi.stubEnv("TYPESAFE_MODEL", "jev-pinned");
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(valid())));
    await askJev(request, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.typesafe.ai/v1/systemone",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: {
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
        },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      ...request,
      model: "jev-pinned",
    });
  });
  it("never exposes provider errors or sends immediate retry storms", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-secret");
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response("private product / test-secret", { status: 429 }),
      );
    await expect(askJev(request, fetcher)).rejects.toThrow("busy");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("turns network failures into a safe recoverable error", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-secret");
    await expect(
      askJev(request, vi.fn().mockRejectedValue(new Error("secret"))),
    ).rejects.toThrow("could not complete");
  });
});
