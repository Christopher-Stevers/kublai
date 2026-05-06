import { EventEmitter } from "events";

export type MaterialListRealtimeEvent = {
  materialListId: string;
  type: "created" | "updated" | "deleted";
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
) {
  state.version += 1;
  const event: MaterialListRealtimeEvent = {
    materialListId,
    type,
    version: state.version,
    changedAt: new Date().toISOString(),
  };

  state.emitter.emit(materialListId, event);
  return event;
}

export function subscribeToMaterialListEvents(
  materialListId: string,
  listener: (event: MaterialListRealtimeEvent) => void,
) {
  state.emitter.on(materialListId, listener);
  return () => state.emitter.off(materialListId, listener);
}
