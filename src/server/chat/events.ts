import { EventEmitter } from "node:events";
const shared = globalThis as unknown as { __jobChatEvents?: EventEmitter };
const emitter = (shared.__jobChatEvents ??= new EventEmitter());
emitter.setMaxListeners(1000);
/** Best-effort wake-up only; database event rows and polling are authoritative. */
export function publishChatEvent(jobId: string) {
  emitter.emit(jobId);
}
export function subscribeChatEvents(jobId: string, listener: () => void) {
  emitter.on(jobId, listener);
  return () => {
    emitter.off(jobId, listener);
  };
}
