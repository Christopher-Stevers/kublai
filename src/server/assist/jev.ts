import { z } from "zod";

export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};
export type DecisionRequest = {
  state: unknown;
  questions: Record<string, ChoiceQuestion>;
};
const probability = z.number().min(0).max(1);
const answerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: probability,
  probabilities: z.record(z.string(), probability),
});
export type ChoiceAnswer = z.infer<typeof answerSchema>;
const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), answerSchema),
});

export class JevError extends Error {}
export function jevConfigured() {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}

// Validate the response against the actual question options, not just its JSON shape.
export function validateAnswers(raw: unknown, request: DecisionRequest) {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success)
    throw new JevError("Jev returned an invalid response. Try again later.");
  const { answers } = parsed.data;
  if (Object.keys(answers).length !== Object.keys(request.questions).length)
    throw new JevError("Jev returned an incomplete response. Try again later.");
  for (const [key, question] of Object.entries(request.questions)) {
    const answer = answers[key];
    const options = Object.keys(question.criteria);
    if (
      !answer ||
      !Object.hasOwn(question.criteria, answer.choice) ||
      Object.keys(answer.probabilities).length !== options.length ||
      options.some((option) => !Object.hasOwn(answer.probabilities, option)) ||
      Math.abs(
        Object.values(answer.probabilities).reduce((a, b) => a + b, 0) - 1,
      ) > 0.02 ||
      Object.values(answer.probabilities).some(
        (p) => p > answer.probabilities[answer.choice]! + 0.0001,
      )
    ) {
      throw new JevError("Jev returned an invalid decision. Try again later.");
    }
  }
  return parsed.data;
}

export async function askJev(
  request: DecisionRequest,
  fetcher: typeof fetch = fetch,
) {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key)
    throw new JevError(
      "AI assistance is not connected yet. Ask your administrator to configure TypeSafe.",
    );
  const questionCount = Object.keys(request.questions).length;
  if (!questionCount || questionCount > 60)
    throw new JevError("Choose a smaller batch to review.");
  const body = JSON.stringify({
    ...request,
    model: process.env.TYPESAFE_MODEL?.trim() || "jev-latest",
  });
  if (Buffer.byteLength(body) > 180_000)
    throw new JevError("This selection is too large. Choose a smaller batch.");
  try {
    const response = await fetcher("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
      redirect: "error",
    });
    // Never return provider bodies, which can include input data or credentials.
    if (!response.ok)
      throw new JevError(
        response.status === 401 || response.status === 403
          ? "TypeSafe credentials were rejected. Ask your administrator to check the connection."
          : response.status === 429 || response.status === 529
            ? "Jev is busy. Please try again in a minute."
            : "Jev is temporarily unavailable. Your records have not changed.",
      );
    return validateAnswers(await response.json(), request);
  } catch (error) {
    if (error instanceof JevError) throw error;
    throw new JevError(
      "Jev could not complete the request. Your records have not changed. Try again later.",
    );
  }
}
