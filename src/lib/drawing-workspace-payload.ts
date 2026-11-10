import type { DrawingWorkspace } from "./drawing-workspace";

/** Keep full records on the server and in explicit offline downloads. */
export function compactDrawingWorkspace(workspace: DrawingWorkspace): DrawingWorkspace {
  return { ...workspace, entities: workspace.entities.map(entity => {
    if (entity.kind !== "markup" || entity.data.type !== "link" || !entity.data.equipmentTag || !entity.data.links?.length) return entity;
    const { links, href: _href, targetSheetId: _target, ...data } = entity.data;
    return { ...entity, data: { ...data, deferredLinks: { id: entity.id, revision: entity.revision, count: links.length } } };
  }) };
}

/** No hyperlink geometry, destinations, or comments travel to a hidden layer. */
export function omitDrawingHyperlinks(workspace: DrawingWorkspace): DrawingWorkspace {
  const omittedHyperlinks: Record<string, number> = {};
  const entities = workspace.entities.filter(entity => {
    if (entity.kind !== "markup" || entity.data.type !== "link") return true;
    if (entity.visibility !== "archived") {
      const source = entity.data.sourceSheetId ?? entity.sheetId;
      omittedHyperlinks[source] = (omittedHyperlinks[source] ?? 0) + 1;
    }
    return false;
  });
  return { ...workspace, entities, omittedHyperlinks };
}

/** A lightweight viewing response must not erase a deliberate offline download. */
export function mergeDrawingWorkspaceSnapshot(workspace: DrawingWorkspace, saved?: DrawingWorkspace | null): DrawingWorkspace {
  if (!saved || saved.sheetId !== workspace.sheetId || saved.actor.id !== workspace.actor.id) return workspace;
  const byId = new Map(saved.entities.map(entity => [entity.id, entity]));
  const retained = workspace.omittedHyperlinks
    ? saved.entities.filter(entity => entity.kind === "markup" && entity.data.type === "link")
    : [];
  return {...workspace, entities:[...retained, ...workspace.entities.map(entity => {
    if (entity.kind !== "markup" || !entity.data.deferredLinks) return entity;
    const full = byId.get(entity.id);
    return full?.revision === entity.revision && full.kind === "markup" && !full.data.deferredLinks ? full : entity;
  })]};
}
