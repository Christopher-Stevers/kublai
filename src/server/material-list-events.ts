import { onBackgroundHint, publishBackgroundHint } from "./background/hints";
import { EventEmitter } from "events";

export type MaterialListRealtimeEvent = {
  materialListId: string;
  organizationId?: string | null;
  type: "created" | "updated" | "deleted";
  version: number;
  changedAt: string;
};

export type ReplicacheRealtimePokeEvent = {
  organizationId: string;
  sourceClientGroupId?: string | null;
  mutationCount: number;
  version: number;
  changedAt: string;
};

export type CatalogueRealtimeEvent = {
  organizationId: string;
  version: number;
  changedAt: string;
};

type MaterialListEventMap = {
  version: number;
  emitter: EventEmitter;
};

declare global {
  // eslint-disable-next-line no-var
  var __foremenhqMaterialListEvents: MaterialListEventMap | undefined;
}

const state =
  globalThis.__foremenhqMaterialListEvents ??
  (globalThis.__foremenhqMaterialListEvents = {
    version: 0,
    emitter: new EventEmitter(),
  });

state.emitter.setMaxListeners(500);

export function publishMaterialListEvent(
  materialListId: string,
  type: MaterialListRealtimeEvent["type"] = "updated",
  organizationId?: string | null,
  broadcast = true,
) {
  state.version += 1;
  const event: MaterialListRealtimeEvent = {
    materialListId,
    organizationId,
    type,
    version: state.version,
    changedAt: new Date().toISOString(),
  };

  state.emitter.emit(materialListId, event);
  if (organizationId)
    state.emitter.emit(`organization:${organizationId}`, event);
  if (broadcast)
    publishBackgroundHint({
      topic: "material",
      materialListId,
      organizationId,
      kind: type,
    });
  return event;
}

export function publishOrganizationReplicachePoke(
  organizationId: string,
  input: { sourceClientGroupId?: string | null; mutationCount?: number } = {},
  broadcast = true,
) {
  state.version += 1;
  const event: ReplicacheRealtimePokeEvent = {
    organizationId,
    sourceClientGroupId: input.sourceClientGroupId ?? null,
    mutationCount: input.mutationCount ?? 0,
    version: state.version,
    changedAt: new Date().toISOString(),
  };

  state.emitter.emit(`replicache:${organizationId}`, event);
  if (broadcast) publishBackgroundHint({ topic: "poke", organizationId });
  return event;
}

export function publishOrganizationCatalogueEvent(
  organizationId: string,
  broadcast = true,
) {
  state.version += 1;
  const event: CatalogueRealtimeEvent = {
    organizationId,
    version: state.version,
    changedAt: new Date().toISOString(),
  };

  state.emitter.emit(`catalogue:${organizationId}`, event);
  if (broadcast) publishBackgroundHint({ topic: "catalogue", organizationId });
  return event;
}

export function subscribeToMaterialListEvents(
  materialListId: string,
  listener: (event: MaterialListRealtimeEvent) => void,
) {
  state.emitter.on(materialListId, listener);
  return () => state.emitter.off(materialListId, listener);
}

export function subscribeToOrganizationMaterialListEvents(
  organizationId: string,
  listener: (event: MaterialListRealtimeEvent) => void,
) {
  const key = `organization:${organizationId}`;
  state.emitter.on(key, listener);
  return () => state.emitter.off(key, listener);
}

export function subscribeToOrganizationReplicachePokes(
  organizationId: string,
  listener: (event: ReplicacheRealtimePokeEvent) => void,
) {
  const key = `replicache:${organizationId}`;
  state.emitter.on(key, listener);
  return () => state.emitter.off(key, listener);
}

export function subscribeToOrganizationCatalogueEvents(
  organizationId: string,
  listener: (event: CatalogueRealtimeEvent) => void,
) {
  const key = `catalogue:${organizationId}`;
  state.emitter.on(key, listener);
  return () => state.emitter.off(key, listener);
}

onBackgroundHint((hint) => {
  if (hint.topic === "material")
    publishMaterialListEvent(
      hint.materialListId,
      hint.kind,
      hint.organizationId,
      false,
    );
  if (hint.topic === "poke")
    publishOrganizationReplicachePoke(hint.organizationId, {}, false);
  if (hint.topic === "catalogue")
    publishOrganizationCatalogueEvent(hint.organizationId, false);
});
