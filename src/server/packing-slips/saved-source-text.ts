import { open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { documentBlobPath } from "~/server/documents/storage";
import {
  boundedSlipBox,
  type SlipSourceWord,
} from "~/lib/slip-source-selection";

const cachedText = z.object({
  rows: z
    .array(
      z.object({
        page: z.number().int().min(1).max(20),
        words: z
          .array(
            z.object({
              text: z.string().max(4000),
              x: z.number().finite(),
              y: z.number().finite(),
              width: z.number().finite(),
              height: z.number().finite(),
            }),
          )
          .max(1000),
      }),
    )
    .max(500),
});

/** Read existing extraction only. A missing cache never schedules OCR/model work. */
export async function savedSlipSourceWords(
  organizationId: string,
  sha256: string,
): Promise<SlipSourceWord[]> {
  const file = path.join(
    path.dirname(documentBlobPath(organizationId, sha256)),
    ".slip-cache-v2",
    sha256,
    "text.json",
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(file, "r");
    if ((await handle.stat()).size > 4 * 1024 * 1024) return [];
    const parsed = cachedText.safeParse(
      JSON.parse(await handle.readFile("utf8")),
    );
    if (!parsed.success) return [];
    return parsed.data.rows.flatMap((row) =>
      row.words.flatMap((word) => {
        const box = boundedSlipBox(word);
        return box && word.text.trim()
          ? [{ ...box, text: word.text, page: row.page }]
          : [];
      }),
    );
  } catch {
    return [];
  } finally {
    await handle?.close();
  }
}
