const state = globalThis as typeof globalThis & {
  chatMaintenanceTimer?: NodeJS.Timeout;
  modelConversionTimer?: NodeJS.Timeout;
  roomDetectionTimer?: NodeJS.Timeout;
};
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    if (!state.modelConversionTimer && process.env.BIM_WORKER_DISABLED !== "1") {
      const { dispatchModelConversions } = await import("~/server/models/conversion");
      const dispatch = () => void dispatchModelConversions().catch(() => console.warn("Model conversion queue will retry."));
      state.modelConversionTimer = setInterval(dispatch, 30000);
      state.modelConversionTimer.unref();
      dispatch();
    }
    const { dispatchDetectQueue } =
      await import("~/server/rooms/detect-worker-process");
    if (!state.roomDetectionTimer) {
      const dispatch = () => {
        void dispatchDetectQueue().catch((error) => {
          console.error("[detect-queue] Dispatch will retry", error);
        });
      };
      state.roomDetectionTimer = setInterval(dispatch, 3000);
      state.roomDetectionTimer.unref();
      dispatch();
    }
    const { startChatPushWorker } = await import("~/server/chat/push");
    startChatPushWorker();
    const { startConversationPushWorker } =
      await import("~/server/conversations/push");
    startConversationPushWorker();
    const { startDrawingPushWorker } =
      await import("~/server/drawings/push-worker");
    startDrawingPushWorker();
    const { startMaterialPushWorker } =
      await import("~/server/notifications/material-push-worker");
    startMaterialPushWorker();
    if (!state.chatMaintenanceTimer) {
      let running = false;
      const cleanup = async () => {
        if (running) return;
        running = true;
        try {
          const { cleanupChatAttachments } =
            await import("~/server/chat/maintenance");
          await cleanupChatAttachments();
        } catch {
          console.warn("Pending chat attachment cleanup will retry later.");
        } finally {
          running = false;
        }
      };
      state.chatMaintenanceTimer = setInterval(() => void cleanup(), 3600000);
      state.chatMaintenanceTimer.unref();
      void cleanup();
    }
  }
}
