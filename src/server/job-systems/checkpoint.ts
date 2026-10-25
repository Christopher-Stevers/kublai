import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Evaluator } from "./analyze";
export function checkpointRoot(organizationId: string, runId: string) {
  return path.join(
    process.env.ASSESSMENT_CHECKPOINT_ROOT ??
      path.join(process.cwd(), "uploads", "assessment-checkpoints"),
    z.string().uuid().parse(organizationId),
    z.string().uuid().parse(runId),
  );
}
export async function checkpoint<T>(
  root: string,
  key: unknown,
  parse: (value: unknown) => T,
  work: () => Promise<T>,
  options?: { shouldSave?: (value: T) => boolean },
): Promise<T> {
  const file = path.join(
    root,
    createHash("sha256").update(JSON.stringify(key)).digest("hex") + ".json",
  );
  let saved: string | undefined;
  try {
    saved = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw Error("Assessment checkpoints are unavailable.");
  }
  if (saved !== undefined) {
    try {
      return parse(JSON.parse(saved));
    } catch {
      /* Recompute an incomplete/corrupt checkpoint from authorized source evidence. */
    }
  }
  const value = parse(await work());
  if (options?.shouldSave && !options.shouldSave(value)) return value;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temp = file + "." + randomUUID();
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
    const dir = await open(root, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await unlink(temp).catch(() => undefined);
  }
  return value;
}
const resultSchema = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal("choice"),
      choice: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export function checkpointEvaluator(
  root: string,
  evaluate: Evaluator,
): Evaluator {
  return (state, questions) =>
    checkpoint(
      root,
      { version: 1, type: "answers", state, questions },
      (v) => resultSchema.parse(v),
      async () => {
        // Bounded retries handle a transient provider failure without losing earlier batches.
        for (let attempt = 0; ; attempt++) {
          try {
            return await evaluate(state, questions);
          } catch (error) {
            if (attempt >= 2) throw error;
            await new Promise((resolve) =>
              setTimeout(resolve, 2000 * (attempt + 1)),
            );
          }
        }
      },
    );
}
