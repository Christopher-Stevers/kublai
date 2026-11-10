export type DrawingFolderNode = { id: string; name: string; parentId?: string | null };

/** Exclude the source and all descendants, and show full paths for duplicate names. */
export function drawingMoveTargets(folders: DrawingFolderNode[], movingId: string) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  return folders.flatMap(folder => {
    const visited = new Set<string>();
    const names: string[] = [];
    let current: DrawingFolderNode | undefined = folder;
    while (current) {
      if (current.id === movingId || visited.has(current.id)) return [];
      visited.add(current.id);
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return [{ id: folder.id, path: names.join(" / ") }];
  }).sort((a, b) => a.path.localeCompare(b.path));
}
