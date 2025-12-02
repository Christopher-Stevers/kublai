import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { adminProcedure, createTRPCRouter } from "~/server/api/trpc";
import { env } from "~/env";
import {
  orders,
  creatives,
  creativeForOrders,
  users,
  slots,
  boards,
  boardTypes,
  backfills,
} from "~/server/db/schema";
import { sendOrderApprovalEmail } from "~/server/utils/email";

// Initialize Stripe with secret key
const stripe = new Stripe(env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2025-11-17.clover",
});

// Helper functions for allocation checking
async function isBoardTypeAllocated(
  db: typeof import("~/server/db").db,
  boardTypeId: string,
): Promise<boolean> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(slots)
    .innerJoin(boards, eq(slots.boardId, boards.id))
    .where(eq(boards.boardTypeId, boardTypeId))
    .limit(1);

  return (result[0]?.count ?? 0) > 0;
}

async function isBoardAllocated(
  db: typeof import("~/server/db").db,
  boardId: string,
): Promise<boolean> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(slots)
    .where(eq(slots.boardId, boardId))
    .limit(1);

  return (result[0]?.count ?? 0) > 0;
}

async function getBoardTypeBoardsCount(
  db: typeof import("~/server/db").db,
  boardTypeId: string,
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(boards)
    .where(eq(boards.boardTypeId, boardTypeId))
    .limit(1);

  return result[0]?.count ?? 0;
}

export const adminRouter = createTRPCRouter({
  getPendingOrders: adminProcedure.query(async ({ ctx }) => {
    // Get all orders that are not approved yet
    const pendingOrders = await ctx.db
      .select({
        order: orders,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
        },
      })
      .from(orders)
      .leftJoin(users, eq(orders.userId, users.id))
      .where(eq(orders.approved, false))
      .orderBy(orders.createdAt);

    // For each order, get its associated creatives
    const ordersWithCreatives = await Promise.all(
      pendingOrders.map(async ({ order, user }) => {
        // Get creatives for this order
        const orderCreatives = await ctx.db
          .select({
            creative: creatives,
            creativeForOrder: creativeForOrders,
          })
          .from(creativeForOrders)
          .innerJoin(creatives, eq(creativeForOrders.creativeId, creatives.id))
          .where(eq(creativeForOrders.orderId, order.id));

        return {
          order,
          user,
          creatives: orderCreatives.map((item) => item.creative),
        };
      }),
    );

    return ordersWithCreatives;
  }),

  getPendingCreatives: adminProcedure
    .input(
      z
        .object({
          orderId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (input?.orderId) {
        // Get creatives for a specific order
        const orderCreatives = await ctx.db
          .select({
            creative: creatives,
            creativeForOrder: creativeForOrders,
          })
          .from(creativeForOrders)
          .innerJoin(creatives, eq(creativeForOrders.creativeId, creatives.id))
          .where(
            and(
              eq(creativeForOrders.orderId, input.orderId),
              eq(creatives.approved, false),
            ),
          );

        return orderCreatives.map((item) => item.creative);
      } else {
        // Get all pending creatives
        const allPendingCreatives = await ctx.db
          .select()
          .from(creatives)
          .where(eq(creatives.approved, false));

        return allPendingCreatives;
      }
    }),

  approveCreative: adminProcedure
    .input(
      z.object({
        creativeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const adminId = ctx.session.user.id;

      // Check if creative exists
      const [creative] = await ctx.db
        .select()
        .from(creatives)
        .where(eq(creatives.id, input.creativeId))
        .limit(1);

      if (!creative) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Creative not found",
        });
      }

      // Update creative to approved
      const [updatedCreative] = await ctx.db
        .update(creatives)
        .set({
          approved: true,
          approvedBy: adminId,
          approvedAt: new Date(),
        })
        .where(eq(creatives.id, input.creativeId))
        .returning();

      return updatedCreative;
    }),

  approveOrder: adminProcedure
    .input(
      z.object({
        orderId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const adminId = ctx.session.user.id;

      // Get the order
      const [order] = await ctx.db
        .select()
        .from(orders)
        .where(eq(orders.id, input.orderId))
        .limit(1);

      if (!order) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Order not found",
        });
      }

      if (order.approved) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Order is already approved",
        });
      }

      // Get all creatives for this order
      const orderCreatives = await ctx.db
        .select({
          creative: creatives,
        })
        .from(creativeForOrders)
        .innerJoin(creatives, eq(creativeForOrders.creativeId, creatives.id))
        .where(eq(creativeForOrders.orderId, input.orderId));

      // Check if all creatives are approved
      const allCreativesApproved = orderCreatives.every(
        (item) => item.creative.approved === true,
      );

      if (!allCreativesApproved && orderCreatives.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "All creatives in the order must be approved before approving the order",
        });
      }

      // Get the user to charge
      const [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.id, order.userId))
        .limit(1);

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      if (!user.stripeCustomerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User does not have a payment method on file",
        });
      }

      // Get customer's payment methods
      const paymentMethods = await stripe.paymentMethods.list({
        customer: user.stripeCustomerId,
        type: "card",
      });

      if (paymentMethods.data.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User does not have a payment method on file",
        });
      }

      // Use the first available payment method
      const paymentMethod = paymentMethods.data[0];

      if (!paymentMethod) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve payment method",
        });
      }

      // Create and confirm PaymentIntent
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: order.totalPrice, // already in cents
          currency: order.currency ?? "cad",
          customer: user.stripeCustomerId,
          payment_method: paymentMethod.id,
          confirm: true,
          off_session: true,
          metadata: {
            orderId: order.id,
            userId: user.id,
          },
        });

        // Update order with approval and payment info
        const [updatedOrder] = await ctx.db
          .update(orders)
          .set({
            approved: true,
            approvedBy: adminId,
            approvedAt: new Date(),
            stripePaymentIntentId: paymentIntent.id,
            status: paymentIntent.status === "succeeded" ? "paid" : "pending",
          })
          .where(eq(orders.id, input.orderId))
          .returning();

        // Send email notification (non-blocking - don't fail if email fails)
        if (updatedOrder && paymentIntent.status === "succeeded") {
          sendOrderApprovalEmail({
            orderId: updatedOrder.id,
            userEmail: user.email,
            userName: user.name,
            totalPrice: updatedOrder.totalPrice,
            currency: updatedOrder.currency ?? "cad",
          }).catch((emailError) => {
            // Log but don't throw - email failure shouldn't break order approval
            console.error("Failed to send order approval email:", emailError);
          });
        }

        return {
          order: updatedOrder,
          paymentIntent: {
            id: paymentIntent.id,
            status: paymentIntent.status,
          },
        };
      } catch (error) {
        // Handle Stripe errors
        if (error instanceof Stripe.errors.StripeError) {
          throw new TRPCError({
            code: "PAYMENT_REQUIRED",
            message: `Payment failed: ${error.message}`,
            cause: error,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process payment",
          cause: error,
        });
      }
    }),

  getApprovedOrders: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(10),
        sortBy: z.enum(["date", "user", "status"]).default("date"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Get all approved orders with user info first
      const allApprovedOrders = await ctx.db
        .select({
          order: orders,
          user: {
            id: users.id,
            name: users.name,
            email: users.email,
          },
        })
        .from(orders)
        .innerJoin(users, eq(orders.userId, users.id))
        .where(eq(orders.approved, true));

      // Get total count for pagination
      const totalCount = allApprovedOrders.length;
      const totalPages = Math.ceil(totalCount / input.pageSize);

      // For each order, get slots, boards, and creatives
      const ordersWithDetails = await Promise.all(
        allApprovedOrders.map(async ({ order, user }) => {
          // Get slots for this order
          const orderSlots = await ctx.db
            .select({
              slot: slots,
              board: boards,
              boardType: boardTypes,
            })
            .from(slots)
            .innerJoin(boards, eq(slots.boardId, boards.id))
            .innerJoin(boardTypes, eq(boards.boardTypeId, boardTypes.id))
            .where(eq(slots.orderId, order.id))
            .orderBy(asc(slots.startTime));

          // Get earliest start and latest end dates
          const startDates = orderSlots.map((s) => s.slot.startTime);
          const endDates = orderSlots.map((s) => s.slot.endTime);
          const earliestStart =
            startDates.length > 0
              ? new Date(Math.min(...startDates.map((d) => d.getTime())))
              : null;
          const latestEnd =
            endDates.length > 0
              ? new Date(Math.max(...endDates.map((d) => d.getTime())))
              : null;

          // Get first board info (or aggregate if multiple)
          const firstBoard = orderSlots[0];
          const boardInfo = firstBoard
            ? {
                id: firstBoard.board.id,
                vehicleName: firstBoard.board.vehicleName,
                boardTypeName: firstBoard.boardType.name,
              }
            : null;

          // Get creatives for this order
          const orderCreatives = await ctx.db
            .select({
              creative: creatives,
            })
            .from(creativeForOrders)
            .innerJoin(creatives, eq(creativeForOrders.creativeId, creatives.id))
            .where(eq(creativeForOrders.orderId, order.id))
            .limit(1); // Get first creative for preview

          const previewCreative = orderCreatives[0]?.creative ?? null;

          // Generate preview URL if creative exists
          let previewUrl: string | null = null;
          if (previewCreative) {
            // Extract filename from filePath (e.g., "uploads/userId/uuid-filename.ext" -> "uuid-filename.ext")
            const filename = previewCreative.filePath.split("/").pop() ?? null;
            if (filename) {
              previewUrl = `/api/files/${previewCreative.userId}/${filename}`;
            }
          }

          // Get backfills for this order
          const orderBackfills = await ctx.db
            .select()
            .from(backfills)
            .where(eq(backfills.orderId, order.id))
            .orderBy(asc(backfills.startTime));

          return {
            order,
            user,
            slots: orderSlots.map((item) => ({
              id: item.slot.id,
              startTime: item.slot.startTime,
              endTime: item.slot.endTime,
              board: {
                id: item.board.id,
                vehicleName: item.board.vehicleName,
                boardType: {
                  id: item.boardType.id,
                  name: item.boardType.name,
                },
              },
            })),
            backfills: orderBackfills.map((bf) => ({
              id: bf.id,
              hours: bf.hours,
              startTime: bf.startTime,
              endTime: bf.endTime,
            })),
            preview: previewUrl
              ? {
                  url: previewUrl,
                  fileType: previewCreative?.fileType ?? null,
                  fileName: previewCreative?.fileName ?? null,
                }
              : null,
            startDate: earliestStart,
            endDate: latestEnd,
          };
        }),
      );

      // Sort the results
      ordersWithDetails.sort((a, b) => {
        if (input.sortBy === "date") {
          const aDate = a.startDate?.getTime() ?? 0;
          const bDate = b.startDate?.getTime() ?? 0;
          return input.sortOrder === "asc" ? aDate - bDate : bDate - aDate;
        } else if (input.sortBy === "user") {
          const aName = a.user.name ?? a.user.email ?? "";
          const bName = b.user.name ?? b.user.email ?? "";
          const comparison = aName.localeCompare(bName);
          return input.sortOrder === "asc" ? comparison : -comparison;
        } else {
          // status
          const aStatus = a.order.status ?? "";
          const bStatus = b.order.status ?? "";
          const comparison = aStatus.localeCompare(bStatus);
          return input.sortOrder === "asc" ? comparison : -comparison;
        }
      });

      // Apply pagination
      const offset = (input.page - 1) * input.pageSize;
      const paginatedOrders = ordersWithDetails.slice(offset, offset + input.pageSize);

      return {
        orders: paginatedOrders,
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          totalCount,
          totalPages,
        },
      };
    }),

  // Board Types Management
  getBoardTypes: adminProcedure.query(async ({ ctx }) => {
    const allBoardTypes = await ctx.db.select().from(boardTypes);

    // Get boards count and allocation status for each board type
    const boardTypesWithDetails = await Promise.all(
      allBoardTypes.map(async (boardType) => {
        const boardsCount = await getBoardTypeBoardsCount(ctx.db, boardType.id);
        const isAllocated = await isBoardTypeAllocated(ctx.db, boardType.id);

        return {
          ...boardType,
          boardsCount,
          isAllocated,
        };
      }),
    );

    return boardTypesWithDetails;
  }),

  getBoardType: adminProcedure
    .input(
      z.object({
        boardTypeId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [boardType] = await ctx.db
        .select()
        .from(boardTypes)
        .where(eq(boardTypes.id, input.boardTypeId))
        .limit(1);

      if (!boardType) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Board type not found",
        });
      }

      const boardsCount = await getBoardTypeBoardsCount(ctx.db, boardType.id);
      const isAllocated = await isBoardTypeAllocated(ctx.db, boardType.id);

      return {
        ...boardType,
        boardsCount,
        isAllocated,
      };
    }),

  createBoardType: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        imageUrl: z.string().optional(),
        slotCostPerDay: z.number().int().min(0),
        backfillCostPerDay: z.number().int().min(0),
        dimensionX: z.number().int().positive().optional(),
        dimensionY: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Check if name already exists
      const [existing] = await ctx.db
        .select()
        .from(boardTypes)
        .where(eq(boardTypes.name, input.name))
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A board type with this name already exists",
        });
      }

      const [newBoardType] = await ctx.db
        .insert(boardTypes)
        .values({
          name: input.name,
          description: input.description ?? null,
          imageUrl: input.imageUrl ?? null,
          slotCostPerDay: input.slotCostPerDay,
          backfillCostPerDay: input.backfillCostPerDay,
          dimensionX: input.dimensionX ?? null,
          dimensionY: input.dimensionY ?? null,
        })
        .returning();

      return newBoardType;
    }),

  updateBoardType: adminProcedure
    .input(
      z.object({
        boardTypeId: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        imageUrl: z.string().optional(),
        slotCostPerDay: z.number().int().min(0).optional(),
        backfillCostPerDay: z.number().int().min(0).optional(),
        dimensionX: z.number().int().positive().optional(),
        dimensionY: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { boardTypeId, ...updateData } = input;

      // Check if board type exists
      const [existing] = await ctx.db
        .select()
        .from(boardTypes)
        .where(eq(boardTypes.id, boardTypeId))
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Board type not found",
        });
      }

      // Check if board type is allocated
      const isAllocated = await isBoardTypeAllocated(ctx.db, boardTypeId);
      if (isAllocated) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Cannot modify board type that has allocated boards. Please remove all allocations first.",
        });
      }

      // Check name uniqueness if name is being updated
      if (updateData.name && updateData.name !== existing.name) {
        const [nameConflict] = await ctx.db
          .select()
          .from(boardTypes)
          .where(eq(boardTypes.name, updateData.name))
          .limit(1);

        if (nameConflict) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A board type with this name already exists",
          });
        }
      }

      // Build update object with only provided fields
      const updateValues: Partial<typeof boardTypes.$inferInsert> = {};
      if (updateData.name !== undefined) updateValues.name = updateData.name;
      if (updateData.description !== undefined)
        updateValues.description = updateData.description ?? null;
      if (updateData.imageUrl !== undefined)
        updateValues.imageUrl = updateData.imageUrl ?? null;
      if (updateData.slotCostPerDay !== undefined)
        updateValues.slotCostPerDay = updateData.slotCostPerDay;
      if (updateData.backfillCostPerDay !== undefined)
        updateValues.backfillCostPerDay = updateData.backfillCostPerDay;
      if (updateData.dimensionX !== undefined)
        updateValues.dimensionX = updateData.dimensionX ?? null;
      if (updateData.dimensionY !== undefined)
        updateValues.dimensionY = updateData.dimensionY ?? null;

      const [updatedBoardType] = await ctx.db
        .update(boardTypes)
        .set(updateValues)
        .where(eq(boardTypes.id, boardTypeId))
        .returning();

      return updatedBoardType;
    }),

  deleteBoardType: adminProcedure
    .input(
      z.object({
        boardTypeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Check if board type exists
      const [existing] = await ctx.db
        .select()
        .from(boardTypes)
        .where(eq(boardTypes.id, input.boardTypeId))
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Board type not found",
        });
      }

      // Check if any boards exist with this board type
      const boardsCount = await getBoardTypeBoardsCount(ctx.db, input.boardTypeId);
      if (boardsCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot delete board type. There are ${boardsCount} board(s) using this type. Please remove or reassign all boards first.`,
        });
      }

      await ctx.db.delete(boardTypes).where(eq(boardTypes.id, input.boardTypeId));

      return { success: true };
    }),

  // Boards Management
  getBoards: adminProcedure
    .input(
      z.object({
        boardTypeId: z.string().uuid().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input.boardTypeId) {
        conditions.push(eq(boards.boardTypeId, input.boardTypeId));
      }

      const allBoards = await ctx.db
        .select({
          board: boards,
          boardType: boardTypes,
        })
        .from(boards)
        .innerJoin(boardTypes, eq(boards.boardTypeId, boardTypes.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      // Get allocation status for each board
      const boardsWithDetails = await Promise.all(
        allBoards.map(async ({ board, boardType }) => {
          const isAllocated = await isBoardAllocated(ctx.db, board.id);
          return {
            board,
            boardType,
            isAllocated,
          };
        }),
      );

      // Apply pagination
      const totalCount = boardsWithDetails.length;
      const totalPages = Math.ceil(totalCount / input.pageSize);
      const offset = (input.page - 1) * input.pageSize;
      const paginatedBoards = boardsWithDetails.slice(offset, offset + input.pageSize);

      return {
        boards: paginatedBoards,
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          totalCount,
          totalPages,
        },
      };
    }),

  getBoard: adminProcedure
    .input(
      z.object({
        boardId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .select({
          board: boards,
          boardType: boardTypes,
        })
        .from(boards)
        .innerJoin(boardTypes, eq(boards.boardTypeId, boardTypes.id))
        .where(eq(boards.id, input.boardId))
        .limit(1);

      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Board not found",
        });
      }

      const isAllocated = await isBoardAllocated(ctx.db, input.boardId);

      return {
        ...result,
        isAllocated,
      };
    }),

  createBoard: adminProcedure
    .input(
      z.object({
        boardTypeId: z.string().uuid(),
        vehicleName: z.string().max(255).optional(),
        vehicleDescription: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate board type exists
      const [boardType] = await ctx.db
        .select()
        .from(boardTypes)
        .where(eq(boardTypes.id, input.boardTypeId))
        .limit(1);

      if (!boardType) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Board type not found",
        });
      }

      const [newBoard] = await ctx.db
        .insert(boards)
        .values({
          boardTypeId: input.boardTypeId,
          vehicleName: input.vehicleName ?? null,
          vehicleDescription: input.vehicleDescription ?? null,
        })
        .returning();

      return newBoard;
    }),

  updateBoard: adminProcedure
    .input(
      z.object({
        boardId: z.string().uuid(),
        boardTypeId: z.string().uuid().optional(),
        vehicleName: z.string().max(255).optional(),
        vehicleDescription: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { boardId, ...updateData } = input;

      // Check if board exists
      const [existing] = await ctx.db
        .select()
        .from(boards)
        .where(eq(boards.id, boardId))
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Board not found",
        });
      }

      // Check if board is allocated
      const isAllocated = await isBoardAllocated(ctx.db, boardId);
      if (isAllocated) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Cannot modify board that has allocated slots. Please remove all allocations first.",
        });
      }

      // Validate new board type if changing
      if (updateData.boardTypeId && updateData.boardTypeId !== existing.boardTypeId) {
        const [boardType] = await ctx.db
          .select()
          .from(boardTypes)
          .where(eq(boardTypes.id, updateData.boardTypeId))
          .limit(1);

        if (!boardType) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Board type not found",
          });
        }
      }

      // Build update object with only provided fields
      const updateValues: Partial<typeof boards.$inferInsert> = {};
      if (updateData.boardTypeId !== undefined)
        updateValues.boardTypeId = updateData.boardTypeId;
      if (updateData.vehicleName !== undefined)
        updateValues.vehicleName = updateData.vehicleName ?? null;
      if (updateData.vehicleDescription !== undefined)
        updateValues.vehicleDescription = updateData.vehicleDescription ?? null;

      const [updatedBoard] = await ctx.db
        .update(boards)
        .set(updateValues)
        .where(eq(boards.id, boardId))
        .returning();

      return updatedBoard;
    }),

  deleteBoard: adminProcedure
    .input(
      z.object({
        boardId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Check if board exists
      const [existing] = await ctx.db
        .select()
        .from(boards)
        .where(eq(boards.id, input.boardId))
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Board not found",
        });
      }

      // Check if board has slots
      const isAllocated = await isBoardAllocated(ctx.db, input.boardId);
      if (isAllocated) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Cannot delete board that has allocated slots. Please remove all allocations first.",
        });
      }

      await ctx.db.delete(boards).where(eq(boards.id, input.boardId));

      return { success: true };
    }),
});

