import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import {
  assertCan,
  assertCanAccessTab,
  userCan,
} from "~/server/auth/permissions";
import {
  timeSettings,
  timeSheets,
  timeEntries,
  timeClocks,
  timeEvents,
} from "~/server/db/schema";
import { jobs, users } from "~/server/timesheets/tables";
import type { db } from "~/server/db";
import {
  addDays,
  clockDays,
  dateInput,
  defaultTimeSettings,
  entryInput,
  localDate,
  settingsInput,
  timePeriod,
  type TimeSettings,
} from "~/lib/timesheets";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = {
  id: string;
  organizationId: string;
  name: string | null;
  email: string;
};
type Sheet = typeof timeSheets.$inferSelect;
function fail(
  message: string,
  code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" = "BAD_REQUEST",
): never {
  throw new TRPCError({ code, message });
}
const revision = z.number().int().nonnegative();
const person = z.string().min(1).max(255).optional();
const sheetInput = z.object({
  sheetId: z.string().uuid(),
  expectedRevision: revision,
});
const procedure = hasDashboardAccess.use(({ ctx, next }) => {
  assertCanAccessTab(ctx.user, "timesheets");
  return next({
    ctx: { canManageTime: userCan(ctx.user, "timesheets.manage") },
  });
});
async function lock(tx: Tx, org: string, user: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${org + ":timesheets:" + user}, 51))`,
  );
}
async function policy(tx: Tx | typeof db, org: string) {
  const [saved] = await tx
    .select()
    .from(timeSettings)
    .where(eq(timeSettings.organizationId, org));
  return {
    ...defaultTimeSettings,
    ...saved,
    cadence: (saved?.cadence ?? "weekly") as TimeSettings["cadence"],
    revision: saved?.revision ?? 0,
  };
}
async function member(
  tx: Tx | typeof db,
  actor: Actor,
  requested: string | undefined,
  manage: boolean,
  historical = false,
) {
  const id = requested ?? actor.id;
  if (id !== actor.id && !manage)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only access your own timesheets.",
    });
  const [found] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.id, id), eq(users.organizationId, actor.organizationId)),
    );
  if (!found) {
    const [recorded] =
      historical && manage
        ? await tx
            .select({ id: timeSheets.id })
            .from(timeSheets)
            .where(
              and(
                eq(timeSheets.organizationId, actor.organizationId),
                eq(timeSheets.userId, id),
              ),
            )
            .limit(1)
        : [];
    if (!recorded) fail("Employee not found.", "NOT_FOUND");
  }
  return id;
}
async function jobName(tx: Tx, org: string, id: string | null) {
  if (!id) return "General";
  const [job] = await tx
    .select({ name: jobs.name })
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.organizationId, org)));
  if (!job) fail("Job not found in your company.", "NOT_FOUND");
  return job.name;
}
async function period(
  tx: Tx | typeof db,
  org: string,
  user: string,
  date: string,
  create = false,
) {
  const [existing] = await tx
    .select()
    .from(timeSheets)
    .where(
      and(
        eq(timeSheets.organizationId, org),
        eq(timeSheets.userId, user),
        lte(timeSheets.startDate, date),
        gte(timeSheets.endDate, date),
      ),
    );
  if (existing)
    return {
      sheet: existing,
      start: existing.startDate,
      end: existing.endDate,
    };
  let range = timePeriod(date, await policy(tx, org));
  // Changing a company's cadence never merges, rewrites or overlaps existing periods.
  const [overlap] = await tx
    .select({ id: timeSheets.id })
    .from(timeSheets)
    .where(
      and(
        eq(timeSheets.organizationId, org),
        eq(timeSheets.userId, user),
        lte(timeSheets.startDate, range.end),
        gte(timeSheets.endDate, range.start),
      ),
    )
    .limit(1);
  if (overlap) range = { start: date, end: date };
  const [created] = create
    ? await tx
        .insert(timeSheets)
        .values({
          organizationId: org,
          userId: user,
          startDate: range.start,
          endDate: range.end,
        })
        .returning()
    : [];
  return { sheet: created ?? null, ...range };
}
async function loadSheet(tx: Tx, actor: Actor, id: string, manage: boolean) {
  const [sheet] = await tx
    .select()
    .from(timeSheets)
    .where(
      and(
        eq(timeSheets.id, id),
        eq(timeSheets.organizationId, actor.organizationId),
      ),
    );
  if (!sheet) fail("Timesheet not found.", "NOT_FOUND");
  await member(tx, actor, sheet.userId, manage, true);
  await lock(tx, actor.organizationId, sheet.userId);
  // All mutations share this employee lock; read state again after acquiring it.
  const [current] = await tx
    .select()
    .from(timeSheets)
    .where(eq(timeSheets.id, sheet.id));
  return current!;
}
function check(sheet: Sheet, expected: number, editable = true) {
  if (sheet.revision !== expected)
    fail("This timesheet changed. Reload it before saving.", "CONFLICT");
  if (editable && !["draft", "returned"].includes(sheet.status))
    fail(
      "This timesheet is locked. Withdraw the submission or ask a manager to return it for correction.",
      "CONFLICT",
    );
}
async function event(
  tx: Tx,
  actor: Actor,
  userId: string,
  sheetId: string | null,
  action: string,
  data: unknown,
) {
  await tx.insert(timeEvents).values({
    organizationId: actor.organizationId,
    userId,
    sheetId,
    actorId: actor.id,
    actorName: actor.name ?? actor.email,
    action,
    data,
  });
}
async function bump(tx: Tx, sheet: Sheet) {
  await tx
    .update(timeSheets)
    .set({ revision: sheet.revision + 1, updatedAt: new Date() })
    .where(eq(timeSheets.id, sheet.id));
}
async function dayTotal(
  tx: Tx,
  sheet: Sheet,
  date: string,
  minutes: number,
  except?: string,
) {
  const [total] = await tx
    .select({
      minutes: sql<number>`coalesce(sum(${timeEntries.minutes} + ${timeEntries.breakMinutes}),0)::int`,
    })
    .from(timeEntries)
    .innerJoin(timeSheets, eq(timeSheets.id, timeEntries.sheetId))
    .where(
      and(
        eq(timeSheets.organizationId, sheet.organizationId),
        eq(timeSheets.userId, sheet.userId),
        eq(timeEntries.date, date),
        except ? ne(timeEntries.id, except) : undefined,
      ),
    );
  if ((total?.minutes ?? 0) + minutes > 1440)
    fail(
      "Recorded hours including breaks exceed 24 hours for this day. Check for duplicate entries.",
    );
}

export const timesheetsRouter = createTRPCRouter({
  context: procedure.query(async ({ ctx }) => {
    const [settings, jobList, people, clocks] = await Promise.all([
      policy(ctx.db, ctx.user.organizationId),
      ctx.db
        .select({ id: jobs.id, name: jobs.name })
        .from(jobs)
        .where(eq(jobs.organizationId, ctx.user.organizationId))
        .orderBy(asc(jobs.name)),
      ctx.canManageTime
        ? ctx.db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.organizationId, ctx.user.organizationId))
            .orderBy(asc(users.name))
        : Promise.resolve([]),
      ctx.db
        .select()
        .from(timeClocks)
        .where(
          and(
            eq(timeClocks.organizationId, ctx.user.organizationId),
            eq(timeClocks.userId, ctx.user.id),
          ),
        ),
    ]);
    return {
      settings,
      jobs: jobList,
      people,
      clock: clocks[0] ?? null,
      me: ctx.user.id,
      canEdit: userCan(ctx.user, "timesheets.edit"),
      canManage: ctx.canManageTime,
      canConfigure: userCan(ctx.user, "org.settings"),
      today: localDate(new Date(), settings.timezone),
    };
  }),
  period: procedure
    .input(z.object({ date: dateInput, userId: person }))
    .query(async ({ ctx, input }) => {
      const user = await member(
        ctx.db,
        ctx.user,
        input.userId,
        ctx.canManageTime,
        true,
      );
      const selected = await period(
        ctx.db,
        ctx.user.organizationId,
        user,
        input.date,
      );
      const [entries, events] = selected.sheet
        ? await Promise.all([
            ctx.db
              .select()
              .from(timeEntries)
              .where(eq(timeEntries.sheetId, selected.sheet.id))
              .orderBy(asc(timeEntries.date), asc(timeEntries.createdAt)),
            ctx.db
              .select({
                data: timeEvents.data,
                action: timeEvents.action,
                actorName: timeEvents.actorName,
                createdAt: timeEvents.createdAt,
              })
              .from(timeEvents)
              .where(eq(timeEvents.sheetId, selected.sheet.id))
              .orderBy(desc(timeEvents.createdAt), desc(timeEvents.id))
              .limit(100),
          ])
        : [[], []];
      return { ...selected, entries, events, userId: user };
    }),
  saveEntry: procedure
    .input(
      z.object({
        entry: entryInput,
        userId: person,
        expectedRevision: revision,
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const user = await member(
          tx,
          ctx.user,
          input.userId,
          ctx.canManageTime,
          true,
        );
        if (user === ctx.user.id) assertCan(ctx.user, "timesheets.edit");
        await lock(tx, ctx.user.organizationId, user);
        const [currentMember] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.id, user),
              eq(users.organizationId, ctx.user.organizationId),
            ),
          );
        if (!currentMember) {
          const existing = await period(
            tx,
            ctx.user.organizationId,
            user,
            input.entry.date,
          );
          if (!existing.sheet)
            fail(
              "Former employees can only have existing timesheets corrected.",
            );
        }
        const selected = await period(
          tx,
          ctx.user.organizationId,
          user,
          input.entry.date,
          true,
        );
        const sheet = selected.sheet!;
        check(sheet, input.expectedRevision);
        const [old] = await tx
          .select()
          .from(timeEntries)
          .where(eq(timeEntries.id, input.entry.id));
        if (old && old.sheetId !== sheet.id)
          fail("This entry belongs to another period.", "NOT_FOUND");
        const name = await jobName(
          tx,
          ctx.user.organizationId,
          input.entry.jobId,
        );
        await dayTotal(
          tx,
          sheet,
          input.entry.date,
          input.entry.minutes + input.entry.breakMinutes,
          old?.id,
        );
        if (old)
          await tx
            .update(timeEntries)
            .set({ ...input.entry, jobName: name, updatedAt: new Date() })
            .where(eq(timeEntries.id, old.id));
        else
          await tx
            .insert(timeEntries)
            .values({ ...input.entry, sheetId: sheet.id, jobName: name });
        await bump(tx, sheet);
        await event(
          tx,
          ctx.user,
          user,
          sheet.id,
          old ? "Entry updated" : "Entry added",
          { before: old ?? null, after: { ...input.entry, jobName: name } },
        );
        return { sheetId: sheet.id };
      }),
    ),
  deleteEntry: procedure
    .input(sheetInput.extend({ entryId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const sheet = await loadSheet(
          tx,
          ctx.user,
          input.sheetId,
          ctx.canManageTime,
        );
        if (sheet.userId === ctx.user.id)
          assertCan(ctx.user, "timesheets.edit");
        check(sheet, input.expectedRevision);
        const [entry] = await tx
          .select()
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.id, input.entryId),
              eq(timeEntries.sheetId, sheet.id),
            ),
          );
        if (!entry) fail("Entry not found.", "NOT_FOUND");
        await tx.delete(timeEntries).where(eq(timeEntries.id, entry.id));
        await bump(tx, sheet);
        await event(tx, ctx.user, sheet.userId, sheet.id, "Entry deleted", {
          before: entry,
        });
        return { ok: true };
      }),
    ),
  submit: procedure.input(sheetInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const sheet = await loadSheet(
        tx,
        ctx.user,
        input.sheetId,
        ctx.canManageTime,
      );
      if (sheet.userId === ctx.user.id) assertCan(ctx.user, "timesheets.edit");
      check(sheet, input.expectedRevision);
      const [entry] = await tx
        .select({ id: timeEntries.id })
        .from(timeEntries)
        .where(eq(timeEntries.sheetId, sheet.id))
        .limit(1);
      if (!entry) fail("Add some hours before submitting.");
      const [clock] = await tx
        .select()
        .from(timeClocks)
        .where(
          and(
            eq(timeClocks.organizationId, sheet.organizationId),
            eq(timeClocks.userId, sheet.userId),
          ),
        );
      if (
        clock?.periods.some(
          (p) =>
            localDate(new Date(p.start), clock.timezone) <= sheet.endDate &&
            localDate(new Date(p.end ?? new Date()), clock.timezone) >=
              sheet.startDate,
        )
      )
        fail("Stop the time clock before submitting this period.");
      await tx
        .update(timeSheets)
        .set({
          status: "submitted",
          revision: sheet.revision + 1,
          submittedAt: new Date(),
          reviewNote: "",
          reviewedAt: null,
          reviewerId: null,
          updatedAt: new Date(),
        })
        .where(eq(timeSheets.id, sheet.id));
      await event(tx, ctx.user, sheet.userId, sheet.id, "Submitted", {});
      return { ok: true };
    }),
  ),
  withdraw: procedure.input(sheetInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const sheet = await loadSheet(
        tx,
        ctx.user,
        input.sheetId,
        ctx.canManageTime,
      );
      if (sheet.userId === ctx.user.id) assertCan(ctx.user, "timesheets.edit");
      check(sheet, input.expectedRevision, false);
      if (sheet.status !== "submitted")
        fail("Only a pending submission can be withdrawn.");
      await tx
        .update(timeSheets)
        .set({
          status: "draft",
          revision: sheet.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(timeSheets.id, sheet.id));
      await event(
        tx,
        ctx.user,
        sheet.userId,
        sheet.id,
        "Submission withdrawn",
        {},
      );
      return { ok: true };
    }),
  ),
  review: procedure
    .input(
      sheetInput.extend({
        decision: z.enum(["approve", "return"]),
        note: z.string().trim().max(2000),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        assertCan(ctx.user, "timesheets.manage");
        const sheet = await loadSheet(tx, ctx.user, input.sheetId, true);
        check(sheet, input.expectedRevision, false);
        if (input.decision === "approve" && sheet.status !== "submitted")
          fail("Only submitted timesheets can be approved.");
        if (
          input.decision === "return" &&
          !["submitted", "approved"].includes(sheet.status)
        )
          fail("This timesheet is already editable.");
        if (input.decision === "return" && !input.note)
          fail("Explain what needs to be corrected.");
        await tx
          .update(timeSheets)
          .set({
            status: input.decision === "approve" ? "approved" : "returned",
            revision: sheet.revision + 1,
            reviewNote: input.note,
            reviewerId: ctx.user.id,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(timeSheets.id, sheet.id));
        await event(
          tx,
          ctx.user,
          sheet.userId,
          sheet.id,
          input.decision === "approve" ? "Approved" : "Returned for correction",
          { note: input.note, previousStatus: sheet.status },
        );
        return { ok: true };
      }),
    ),
  list: procedure
    .input(
      z.object({
        from: dateInput,
        to: dateInput,
        team: z.boolean().default(false),
        status: z
          .enum(["all", "draft", "submitted", "approved", "returned"])
          .default("all"),
        offset: z.number().int().min(0).max(100000).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.to < input.from || input.to > addDays(input.from, 366))
        fail("Choose a date range of up to one year.");
      if (input.team) assertCan(ctx.user, "timesheets.manage");
      return ctx.db
        .select({
          id: timeSheets.id,
          userId: timeSheets.userId,
          name: users.name,
          email: users.email,
          startDate: timeSheets.startDate,
          endDate: timeSheets.endDate,
          status: timeSheets.status,
          revision: timeSheets.revision,
          reviewNote: timeSheets.reviewNote,
          minutes: sql<number>`coalesce(sum(${timeEntries.minutes}),0)::int`,
        })
        .from(timeSheets)
        .innerJoin(users, eq(users.id, timeSheets.userId))
        .leftJoin(timeEntries, eq(timeEntries.sheetId, timeSheets.id))
        .where(
          and(
            eq(timeSheets.organizationId, ctx.user.organizationId),
            gte(timeSheets.endDate, input.from),
            lte(timeSheets.startDate, input.to),
            input.team ? undefined : eq(timeSheets.userId, ctx.user.id),
            input.status === "all"
              ? undefined
              : eq(timeSheets.status, input.status),
          ),
        )
        .groupBy(timeSheets.id, users.id)
        .orderBy(
          desc(timeSheets.startDate),
          asc(users.name),
          asc(timeSheets.id),
        )
        .limit(100)
        .offset(input.offset);
    }),
  report: procedure
    .input(
      z.object({
        from: dateInput,
        to: dateInput,
        team: z.boolean(),
        approvedOnly: z.boolean().default(true),
        jobId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.to < input.from || input.to > addDays(input.from, 366))
        fail("Choose a date range of up to one year.");
      if (input.team) assertCan(ctx.user, "timesheets.manage");
      const rows = await ctx.db
        .select({
          employee: users.name,
          email: users.email,
          userId: users.id,
          periodStart: timeSheets.startDate,
          periodEnd: timeSheets.endDate,
          status: timeSheets.status,
          date: timeEntries.date,
          job: timeEntries.jobName,
          jobId: timeEntries.jobId,
          category: timeEntries.category,
          minutes: timeEntries.minutes,
          breakMinutes: timeEntries.breakMinutes,
          costCode: timeEntries.costCode,
          notes: timeEntries.notes,
        })
        .from(timeEntries)
        .innerJoin(timeSheets, eq(timeSheets.id, timeEntries.sheetId))
        .innerJoin(users, eq(users.id, timeSheets.userId))
        .where(
          and(
            eq(timeSheets.organizationId, ctx.user.organizationId),
            gte(timeEntries.date, input.from),
            lte(timeEntries.date, input.to),
            input.team ? undefined : eq(timeSheets.userId, ctx.user.id),
            input.approvedOnly ? eq(timeSheets.status, "approved") : undefined,
            input.jobId ? eq(timeEntries.jobId, input.jobId) : undefined,
          ),
        )
        .orderBy(asc(timeEntries.date), asc(users.name), asc(timeEntries.id))
        .limit(10001);
      if (rows.length > 10000)
        fail(
          "This report has more than 10,000 entries. Choose a shorter date range to export all entries.",
        );
      return rows;
    }),
  activity: procedure
    .input(
      z.object({
        team: z.boolean().default(false),
        offset: z.number().int().min(0).max(100000).default(0),
      }),
    )
    .query(({ ctx, input }) => {
      if (input.team) assertCan(ctx.user, "timesheets.manage");
      return ctx.db
        .select()
        .from(timeEvents)
        .where(
          and(
            eq(timeEvents.organizationId, ctx.user.organizationId),
            input.team ? undefined : eq(timeEvents.userId, ctx.user.id),
          ),
        )
        .orderBy(desc(timeEvents.createdAt), desc(timeEvents.id))
        .limit(100)
        .offset(input.offset);
    }),
  settings: procedure
    .input(settingsInput.extend({ expectedRevision: revision }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        assertCan(ctx.user, "org.settings");
        await lock(tx, ctx.user.organizationId, "settings");
        const current = await policy(tx, ctx.user.organizationId);
        if (current.revision !== input.expectedRevision)
          fail("Company settings changed. Reload before saving.", "CONFLICT");
        const data = {
          cadence: input.cadence,
          weekStartsOn: input.weekStartsOn,
          timezone: input.timezone,
          revision: current.revision + 1,
          updatedAt: new Date(),
        };
        await tx
          .insert(timeSettings)
          .values({ organizationId: ctx.user.organizationId, ...data })
          .onConflictDoUpdate({
            target: timeSettings.organizationId,
            set: data,
          });
        await event(
          tx,
          ctx.user,
          ctx.user.id,
          null,
          "Company time settings changed",
          { before: current, after: data },
        );
        return { ok: true };
      }),
    ),
  clockStart: procedure
    .input(
      z.object({
        jobId: z.string().uuid().nullable(),
        notes: z.string().trim().max(2000),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        assertCan(ctx.user, "timesheets.edit");
        await lock(tx, ctx.user.organizationId, ctx.user.id);
        const [active] = await tx
          .select()
          .from(timeClocks)
          .where(
            and(
              eq(timeClocks.organizationId, ctx.user.organizationId),
              eq(timeClocks.userId, ctx.user.id),
            ),
          );
        if (active)
          fail(
            "You are already clocked in. Refresh to see your timer.",
            "CONFLICT",
          );
        const settings = await policy(tx, ctx.user.organizationId),
          now = new Date();
        const selected = await period(
          tx,
          ctx.user.organizationId,
          ctx.user.id,
          localDate(now, settings.timezone),
        );
        if (
          selected.sheet &&
          !["draft", "returned"].includes(selected.sheet.status)
        )
          fail(
            "Today's timesheet is locked. Ask a manager to return it before recording more time.",
          );
        const [clock] = await tx
          .insert(timeClocks)
          .values({
            ...input,
            organizationId: ctx.user.organizationId,
            userId: ctx.user.id,
            jobName: await jobName(tx, ctx.user.organizationId, input.jobId),
            timezone: settings.timezone,
            periods: [{ start: now.toISOString(), end: null, kind: "work" }],
          })
          .returning();
        await event(tx, ctx.user, ctx.user.id, null, "Clocked in", {
          clockId: clock!.id,
          jobName: clock!.jobName,
          ...input,
        });
        return { ok: true };
      }),
    ),
  clockAction: procedure
    .input(
      z.object({
        id: z.string().uuid(),
        expectedRevision: revision,
        action: z.enum(["pause", "resume", "stop", "cancel"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        assertCan(ctx.user, "timesheets.edit");
        await lock(tx, ctx.user.organizationId, ctx.user.id);
        const [clock] = await tx
          .select()
          .from(timeClocks)
          .where(
            and(
              eq(timeClocks.id, input.id),
              eq(timeClocks.organizationId, ctx.user.organizationId),
              eq(timeClocks.userId, ctx.user.id),
            ),
          );
        if (!clock)
          fail(
            "This timer has already stopped. Reload to see your entries.",
            "CONFLICT",
          );
        if (clock.revision !== input.expectedRevision)
          fail("Timer changed on another device. Reload first.", "CONFLICT");
        const now = new Date(),
          periods = clock.periods.map((p) => ({ ...p }));
        const last = periods.at(-1)!;
        if (input.action === "pause" || input.action === "resume") {
          const kind = input.action === "pause" ? "break" : "work";
          if (last.kind === kind) fail("Timer is already in that mode.");
          if (periods.length >= 1000)
            fail("Stop this timer before taking more breaks.");
          last.end = now.toISOString();
          periods.push({ start: now.toISOString(), end: null, kind });
          await tx
            .update(timeClocks)
            .set({ periods, revision: clock.revision + 1 })
            .where(eq(timeClocks.id, clock.id));
        } else {
          last.end = now.toISOString();
          if (input.action === "stop") {
            let days: ReturnType<typeof clockDays>;
            try {
              days = clockDays(periods, now, clock.timezone);
            } catch (error) {
              fail(
                error instanceof Error
                  ? error.message
                  : "Timer could not be recorded.",
              );
            }
            if (!days!.length)
              fail(
                "Work for at least 30 seconds before stopping, or cancel this timer.",
              );
            for (const day of days!) {
              const selected = await period(
                  tx,
                  ctx.user.organizationId,
                  ctx.user.id,
                  day.date,
                  true,
                ),
                sheet = selected.sheet!;
              check(sheet, sheet.revision);
              await dayTotal(
                tx,
                sheet,
                day.date,
                day.minutes + day.breakMinutes,
              );
              const [entry] = await tx
                .insert(timeEntries)
                .values({
                  ...day,
                  sheetId: sheet.id,
                  jobId: clock.jobId,
                  jobName: clock.jobName,
                  category: "work",
                  notes: clock.notes,
                  source: "timer",
                })
                .returning();
              await bump(tx, sheet);
              await event(
                tx,
                ctx.user,
                ctx.user.id,
                sheet.id,
                "Timer recorded",
                { clockId: clock.id, entry },
              );
            }
          }
          await tx.delete(timeClocks).where(eq(timeClocks.id, clock.id));
        }
        await event(tx, ctx.user, ctx.user.id, null, `Timer ${input.action}`, {
          clockId: clock.id,
          ...(input.action === "pause" || input.action === "resume"
            ? { interval: last, nextMode: periods.at(-1)?.kind }
            : { periods }),
        });
        return { ok: true };
      }),
    ),
});
