import type { DrawingWorkspace } from "./drawing-workspace";

/** Keep full records on the server and in explicit offline downloads. */
export function compactDrawingWorkspace(workspace: DrawingWorkspace): DrawingWorkspace {
  return { ...workspace, entities: workspace.entities.map(entity => {
    if (entity.kind !== "markup" || entity.data.type !== "link" || !entity.data.equipmentTag || !entity.data.links?.length) return entity;
    const { links, href: _href, targetSheetId: _target, ...data } = entity.data;
    return { ...entity, data: { ...data, deferredLinks: { id: entity.id, revision: entity.revision, count: links.length } } };
  }) };
}
