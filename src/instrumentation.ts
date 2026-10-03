const state = globalThis as typeof globalThis & {
  chatMaintenanceTimer?: NodeJS.Timeout;
};
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startChatPushWorker } = await import("~/server/chat/push");
    startChatPushWorker();
    if (!state.chatMaintenanceTimer) {
      let running = false;
      const cleanup = async () => {
        if (running) return;
        running = true;
        try {
          const { cleanupExpiredChatAttachments } =
            await import("~/server/chat/attachments");
          await cleanupExpiredChatAttachments();
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
