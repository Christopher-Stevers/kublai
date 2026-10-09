import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  conversationInput,
  createConversationInput,
  sendConversationInput,
} from "~/server/conversations/contracts";
import {
  conversationAccess,
  conversationHistory,
  conversationPeople,
  createConversation,
  listConversations,
  markConversationRead,
  removeConversationMessage,
  sendConversationMessage,
} from "~/server/conversations/service";
const memberProcedure = protectedProcedure
  .input(conversationInput)
  .use(async ({ ctx, input, next }) =>
    next({
      ctx: {
        ...ctx,
        conversation: await conversationAccess(
          ctx.userId,
          input.conversationId,
        ),
      },
    }),
  );
export const conversationsRouter = createTRPCRouter({
  people: protectedProcedure.query(({ ctx }) => conversationPeople(ctx.userId)),
  list: protectedProcedure.query(({ ctx }) => listConversations(ctx.userId)),
  create: protectedProcedure
    .input(createConversationInput)
    .mutation(({ ctx, input }) => createConversation(ctx.userId, input)),
  history: memberProcedure
    .input(
      z.object({
        beforeSequence: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(({ ctx, input }) => conversationHistory(ctx.conversation, input)),
  send: memberProcedure
    .input(sendConversationInput)
    .mutation(({ ctx, input }) =>
      sendConversationMessage(ctx.conversation, input),
    ),
  markRead: memberProcedure
    .input(
      z.object({
        sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .mutation(({ ctx, input }) =>
      markConversationRead(ctx.conversation, input.sequence),
    ),
  remove: memberProcedure
    .input(z.object({ messageId: z.uuid() }))
    .mutation(({ ctx, input }) =>
      removeConversationMessage(ctx.conversation, input.messageId),
    ),
});
