export type DrawingFolderSummaryInput = {
  id: string;
  parentId?: string | null;
  sheetCount: number;
  coverImageUrl?: string | null;
};

/** Counts each descendant once, even if malformed cached data contains a cycle. */
export function drawingFolderSummary(folders: DrawingFolderSummaryInput[], id: string) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const children = new Map<string, string[]>();
  for (const folder of byId.values()) if (folder.parentId) {
    const ids = children.get(folder.parentId) ?? [];
    ids.push(folder.id);
    children.set(folder.parentId, ids);
  }
  const seen = new Set<string>();
  const pending = [id];
  let count = 0;
  let coverImageUrl: string | null = null;
  while (pending.length) {
    const next = pending.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const folder = byId.get(next);
    if (!folder) continue;
    count += folder.sheetCount;
    coverImageUrl ??= folder.coverImageUrl || null;
    pending.push(...(children.get(next) ?? []));
  }
  return { count, coverImageUrl, hasSubfolders: Boolean(children.get(id)?.length) };
}

/** Includes sets with drawings at every level; empty containers need no download. */
export function drawingFolderDownloadSets<T extends DrawingFolderSummaryInput>(folders: T[], id: string): T[] {
  const pending = [id], seen = new Set<string>(), result: T[] = [];
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  while (pending.length) {
    const next = pending.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const folder = byId.get(next);
    if (!folder) continue;
    if (folder.sheetCount > 0) result.push(folder);
    for (const child of byId.values()) if (child.parentId === next) pending.push(child.id);
  }
  return result;
}
