import { z } from "zod";
import {
  snapshotSourceSchema,
  type SnapshotSource,
} from "~/lib/snapshot-source";
export const conversationInput = z.object({ conversationId: z.uuid() });
export const savedSnapshotsInput = z.object({
  search: z.string().trim().max(200).default(""),
  beforeSequence: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
});
export const createConversationInput = z
  .object({
    kind: z.enum(["direct", "group"]),
    name: z.string().trim().max(120).default(""),
    recipientIds: z.array(z.string().min(1).max(255)).min(1).max(49),
  })
  .refine(
    (v) => new Set(v.recipientIds).size === v.recipientIds.length,
    "Choose each person once.",
  );
export const sendConversationInput = conversationInput
  .extend({
    clientId: z.uuid(),
    body: z.string().trim().max(8000),
    attachmentIds: z.array(z.uuid()).max(5).default([]),
    source: snapshotSourceSchema.nullable().optional(),
  })
  .refine(
    (v) => v.body.length > 0 || v.attachmentIds.length > 0,
    "Enter a message or attach a snapshot.",
  )
  .refine(
    (v) => new Set(v.attachmentIds).size === v.attachmentIds.length,
    "Duplicate attachments.",
  );
export const editSnapshotInput = conversationInput.extend({
  messageId: z.uuid(),
  clientId: z.uuid(),
  expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  originalAttachmentId: z.uuid(),
  attachmentId: z.uuid(),
  body: z.string().trim().min(1).max(8000),
  source: snapshotSourceSchema.nullable(),
});
export type ConversationMessage = {
  id: string;
  sequence: number;
  conversationId: string;
  clientId: string;
  body: string;
  author: { id: string | null; name: string };
  createdAt: Date;
  deletedAt: Date | null;
  source?: SnapshotSource | null;
  revision?: number;
  editedAt?: Date | null;
  attachments: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    url: string;
  }[];
};
