import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import {
  boardTypes,
  boards,
  slots,
  orders,
  backfills,
  creativeForOrders,
} from "~/server/db/schema";

export const boardRouter = createTRPCRouter({
  getBoardTypes: publicProcedure.query(async ({ ctx }) => {
    const allBoardTypes = await ctx.db.select().from(boardTypes);
    return allBoardTypes;
  }),

  getAvailability: publicProcedure
    .input(
      z.object({
        boardTypeId: z.string().uuid(),
        startTime: z.date().optional(),
        endTime: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Get all boards of this type
      const boardsOfType = await ctx.db
        .select()
        .from(boards)
        .where(eq(boards.boardTypeId, input.boardTypeId));

      const totalBoards = boardsOfType.length;

      if (totalBoards === 0) {
        return {
          boardTypeId: input.boardTypeId,
          totalBoards: 0,
          availableBoards: 0,
          bookedBoards: 0,
        };
      }

      const boardIds = boardsOfType.map((b) => b.id);

      // Build query for overlapping slots
      // Only check slots from orders with status 'paid' or 'pending'
      const conditions = [
        inArray(slots.boardId, boardIds),
        or(eq(orders.status, "paid"), eq(orders.status, "pending")),
      ];

      // If date range provided, filter slots that overlap
      // Overlap: slot.startTime < requestEndTime AND slot.endTime > requestStartTime
      if (input.startTime && input.endTime) {
        conditions.push(
          sql`${slots.startTime} < ${input.endTime.toISOString()}::timestamp`,
          sql`${slots.endTime} > ${input.startTime.toISOString()}::timestamp`,
        );
      }

      const bookedSlots = await ctx.db
        .select({
          boardId: slots.boardId,
        })
        .from(slots)
        .innerJoin(orders, eq(slots.orderId, orders.id))
        .where(and(...conditions));

      // Get unique board IDs that have overlapping slots
      const bookedBoardIds = new Set(bookedSlots.map((s) => s.boardId));
      const bookedBoards = bookedBoardIds.size;
      const availableBoards = totalBoards - bookedBoards;

      return {
        boardTypeId: input.boardTypeId,
        totalBoards,
        availableBoards,
        bookedBoards,
        requestedTimeRange:
          input.startTime && input.endTime
            ? {
                startTime: input.startTime,
                endTime: input.endTime,
              }
            : undefined,
      };
    }),

  createOrder: protectedProcedure
    .input(
      z.object({
        boardTypeId: z.string().uuid(),
        slots: z.array(
          z.object({
            startTime: z.date(),
            endTime: z.date(),
          }),
        ),
        backfills: z
          .array(
            z.object({
              hours: z.number().int().positive(),
              startTime: z.date(),
              endTime: z.date(),
            }),
          )
          .optional(),
        creativeId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = ctx.session.user.id;

        // Validate board type exists
        const [boardType] = await ctx.db
          .select()
          .from(boardTypes)
          .where(eq(boardTypes.id, input.boardTypeId))
          .limit(1);

        if (!boardType) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Board type not found",
          });
        }

        // Validate slots
        if (input.slots.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "At least one slot is required",
          });
        }

        // Validate slot time ranges
        for (const slot of input.slots) {
          if (slot.startTime >= slot.endTime) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Slot start time must be before end time",
            });
          }
        }

        // Get all boards of this type
        const boardsOfType = await ctx.db
          .select()
          .from(boards)
          .where(eq(boards.boardTypeId, input.boardTypeId));

        if (boardsOfType.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No boards available for this board type",
          });
        }

        const boardIds = boardsOfType.map((b) => b.id);
        // Number of vehicles = number of slots in the array
        // Each slot in the array represents one vehicle booking for that time period
        const numberOfVehicles = input.slots.length;

        // Group slots by time period (same startTime/endTime = same period)
        const slotPeriods = new Map<
          string,
          { startTime: Date; endTime: Date; count: number }
        >();
        for (const slot of input.slots) {
          const key = `${slot.startTime.toISOString()}-${slot.endTime.toISOString()}`;
          const existing = slotPeriods.get(key);
          if (existing) {
            existing.count++;
          } else {
            slotPeriods.set(key, {
              startTime: slot.startTime,
              endTime: slot.endTime,
              count: 1,
            });
          }
        }

        // Check availability for each unique time period
        for (const period of slotPeriods.values()) {
          // Find boards that have overlapping slots (from paid/pending orders)
          const overlappingSlots = await ctx.db
            .select({
              boardId: slots.boardId,
            })
            .from(slots)
            .innerJoin(orders, eq(slots.orderId, orders.id))
            .where(
              and(
                inArray(slots.boardId, boardIds),
                or(eq(orders.status, "paid"), eq(orders.status, "pending")),
                sql`${slots.startTime} < ${period.endTime.toISOString()}::timestamp`,
                sql`${slots.endTime} > ${period.startTime.toISOString()}::timestamp`,
              ),
            );

          const bookedBoardIds = new Set(
            overlappingSlots.map((s) => s.boardId),
          );
          const availableBoards = boardIds.length - bookedBoardIds.size;

          if (availableBoards < period.count) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Not enough boards available. Only ${availableBoards} boards available for the requested time period (${period.startTime.toISOString()} - ${period.endTime.toISOString()}).`,
            });
          }
        }

        // Calculate total price
        // Slots: number of slots * slot cost per day * number of days per slot
        let totalPrice = 0;

        for (const slot of input.slots) {
          const days = Math.ceil(
            (slot.endTime.getTime() - slot.startTime.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          totalPrice += boardType.slotCostPerDay * days;
        }

        // Backfills: number of backfills * backfill cost per day * number of days per backfill
        if (input.backfills && input.backfills.length > 0) {
          for (const backfill of input.backfills) {
            const days = Math.ceil(
              (backfill.endTime.getTime() - backfill.startTime.getTime()) /
                (1000 * 60 * 60 * 24),
            );
            totalPrice += boardType.backfillCostPerDay * days;
          }
        }
        try {
          // Create order
          const [newOrder] = await ctx.db
            .insert(orders)
            .values({
              userId,
              totalPrice,
              currency: "cad",
              status: "pending",
            })
            .returning();

          if (!newOrder) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create order",
            });
          }
          // Create slots - one slot per input, assigned to different boards
          const createdSlots = [];
          const usedBoardIds = new Set<string>();
          try {
            for (const slot of input.slots) {
              // Get available boards for this slot period (excluding already used boards in this transaction)
              const overlappingSlots = await ctx.db
                .select({
                  boardId: slots.boardId,
                })
                .from(slots)
                .innerJoin(orders, eq(slots.orderId, orders.id))
                .where(
                  and(
                    inArray(slots.boardId, boardIds),
                    or(eq(orders.status, "paid"), eq(orders.status, "pending")),
                    sql`${slots.startTime} < ${slot.endTime.toISOString()}::timestamp`,
                    sql`${slots.endTime} > ${slot.startTime.toISOString()}::timestamp`,
                  ),
                );

              const bookedBoardIds = new Set(
                overlappingSlots.map((s) => s.boardId),
              );
              const availableBoardIds = boardIds.filter(
                (id) => !bookedBoardIds.has(id) && !usedBoardIds.has(id),
              );

              if (availableBoardIds.length === 0) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "No available boards for the requested time period",
                });
              }

              // Assign this slot to an available board
              const boardId = availableBoardIds[0]!;
              usedBoardIds.add(boardId);

              const [createdSlot] = await ctx.db
                .insert(slots)
                .values({
                  boardId,
                  orderId: newOrder.id,
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                })
                .returning();
              createdSlots.push(createdSlot);
            }
          } catch (err) {
            console.log("Error creating slot", err);
          }

          // Create backfills if provided
          const createdBackfills = [];
          try {
            if (input.backfills && input.backfills.length > 0) {
              for (const backfill of input.backfills) {
                const [createdBackfill] = await ctx.db
                  .insert(backfills)
                  .values({
                    orderId: newOrder.id,
                    hours: backfill.hours,
                    startTime: backfill.startTime,
                    endTime: backfill.endTime,
                  })
                  .returning();
                createdBackfills.push(createdBackfill);
              }
            }

            // Link creative if provided
            if (input.creativeId) {
              await ctx.db.insert(creativeForOrders).values({
                orderId: newOrder.id,
                creativeId: input.creativeId,
              });
            }
          } catch (err) {
            console.log("Error creating back fill", err);
          }

          return {
            order: newOrder,
            slots: createdSlots,
            backfills: createdBackfills,
          };
        } catch (err) {
          console.log("Error creating order", err);
        }
        return {
          order: [],
          slots: [],
          backfills: [],
        };
      } catch (err) {
        console.log("Failed to create", err);
        return {
          order: [],
          slots: [],
          backfills: [],
        };
      }
    }),
});
