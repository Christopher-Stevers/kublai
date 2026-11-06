import { z } from "zod";

export const hyperlinkScopeInput = z.object({
  scope: z
    .enum(["job", "set", "drawings", "documents", "custom"])
    .default("job"),
  drawingIds: z.array(z.uuid()).max(10000).default([]),
  documentIds: z.array(z.uuid()).max(10000).default([]),
});
export type HyperlinkScope = z.infer<typeof hyperlinkScopeInput>;
export type HyperlinkTargets = {
  drawings: { id: string; name: string; setId: string; setName: string }[];
  documents: { id: string; name: string; folderId: string | null }[];
  folders: { id: string; name: string; parentId: string | null }[];
};
