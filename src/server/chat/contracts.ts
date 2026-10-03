import { createHash } from "node:crypto";
import { z } from "zod";
export const jobInput = z.object({ jobId: z.uuid() });
export const chatSequence = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
export const bodyInput = z.string().trim().max(8000);
export const sendInput = jobInput
  .extend({
    clientId: z.uuid(),
    body: bodyInput,
    replyToId: z.uuid().optional(),
    attachmentIds: z.array(z.uuid()).max(5).default([]),
  })
  .refine(
    (v) => v.body.length > 0 || v.attachmentIds.length > 0,
    "Enter a message or attach a file.",
  )
  .refine(
    (v) => new Set(v.attachmentIds).size === v.attachmentIds.length,
    "Duplicate attachments.",
  );
export function requestHash(input: {
  body: string;
  replyToId?: string;
  attachmentIds: string[];
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.body,
        input.replyToId ?? null,
        [...input.attachmentIds].sort(),
      ]),
    )
    .digest("hex");
}
export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
};
export type ChatMessage = {
  id: string;
  sequence: number;
  jobId: string;
  clientId: string;
  body: string;
  author: { id: string | null; name: string; image: string | null };
  replyToId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  attachments: ChatAttachment[];
};
