import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertChatAccess } from "~/server/chat/access";
import {
  bodyInput,
  chatSequence,
  jobInput,
  sendInput,
} from "~/server/chat/contracts";
import {
  changeChatMessage,
  chatHistory,
  chatMembers,
  chatOverview,
  joinChat,
  markChatRead,
  sendChatMessage,
  setChatNotifications,
} from "~/server/chat/service";

const chatProcedure = protectedProcedure
  .input(jobInput)
  .use(async ({ ctx, input, next }) =>
    next({
      ctx: { ...ctx, chat: await assertChatAccess(ctx.userId, input.jobId) },
    }),
  );
export const chatRouter = createTRPCRouter({
  getOverview: chatProcedure.query(({ ctx }) => chatOverview(ctx.chat)),
  join: chatProcedure.mutation(({ ctx }) => joinChat(ctx.chat)),
  history: chatProcedure
    .input(
      z.object({
        beforeSequence: chatSequence.optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(({ ctx, input }) => chatHistory(ctx.chat, input)),
  send: chatProcedure
    .input(sendInput)
    .mutation(({ ctx, input }) => sendChatMessage(ctx.chat, input)),
  edit: chatProcedure
    .input(z.object({ messageId: z.uuid(), body: bodyInput.min(1) }))
    .mutation(({ ctx, input }) =>
      changeChatMessage(ctx.chat, input.messageId, input.body),
    ),
  delete: chatProcedure
    .input(z.object({ messageId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await changeChatMessage(ctx.chat, input.messageId, null);
      return { success: true as const };
    }),
  markRead: chatProcedure
    .input(z.object({ sequence: chatSequence }))
    .mutation(({ ctx, input }) => markChatRead(ctx.chat, input.sequence)),
  members: chatProcedure.query(({ ctx }) => chatMembers(ctx.chat)),
  setNotifications: chatProcedure
    .input(z.object({ muted: z.boolean() }))
    .mutation(({ ctx, input }) => setChatNotifications(ctx.chat, input.muted)),
});
