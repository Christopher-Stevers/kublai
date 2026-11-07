import { createHash, randomBytes } from "node:crypto";
import { and, eq, desc, sql, gt, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "~/server/db";
import { users } from "~/server/chat/tables";
import {
  employeeSimulationSessions as sessions,
  employeeSimulationAudit as audit,
} from "~/server/db/simulation-schema";
import type { RequestUser } from "~/server/utils/get-request-identity";
import {
  SIMULATION_COOKIE,
  SIMULATION_VIEW_HEADER,
  type EmployeeSimulation,
} from "~/lib/employee-simulation";
import { assertSimulationTarget, canSimulateEmployees } from "./policy";
export const SIMULATION_DURATION_SECONDS = 3600;
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function simulationCookie(headers: Headers) {
  const value = headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(SIMULATION_COOKIE + "="))
    ?.slice(SIMULATION_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
async function employeeUser(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return (row ?? null) as RequestUser | null;
}
export async function resolveEmployeeSimulation(
  headers: Headers,
  actor: RequestUser | null,
) {
  const token = simulationCookie(headers);
  if (!token || !actor) return null;
  const [row] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, hash(token)),
        eq(sessions.actorId, actor.id),
        isNull(sessions.endedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (row?.organizationId !== actor.organizationId) return null;
  const employee = await employeeUser(row.employeeId);
  try {
    assertSimulationTarget(actor, employee);
  } catch {
    return null;
  }
  if (!employee) return null;
  const simulation: EmployeeSimulation = {
    id: row.id,
    actorId: actor.id,
    employeeId: employee.id,
    employeeName: employee.name ?? employee.email,
    employeeEmail: employee.email,
    expiresAt: row.expiresAt.toISOString(),
  };
  return { employee, simulation };
}
export function assertSimulationView(
  headers: Headers,
  actor: RequestUser | null,
  simulation: EmployeeSimulation | null,
) {
  const expected = headers.get(SIMULATION_VIEW_HEADER);
  if (
    expected &&
    expected !== (simulation?.id ?? `account:${actor?.id ?? "guest"}`)
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "Your account view changed. Reload before continuing.",
    });
}
export async function startEmployeeSimulation(
  actor: RequestUser,
  employeeId: string,
  headers: Headers,
) {
  const employee = await employeeUser(employeeId);
  assertSimulationTarget(actor, employee);
  if (!employee) throw new TRPCError({ code: "NOT_FOUND" });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SIMULATION_DURATION_SECONDS * 1000);
  const row = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.id},7391))`,
    );
    const [recent] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(
        and(
          eq(sessions.actorId, actor.id),
          gt(sessions.createdAt, new Date(Date.now() - 3600000)),
        ),
      );
    if ((recent?.count ?? 0) >= 30)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many simulation starts. Please try again later.",
      });
    const previous = simulationCookie(headers);
    if (previous) {
      const ended = await tx
        .update(sessions)
        .set({ endedAt: new Date() })
        .where(
          and(
            eq(sessions.tokenHash, hash(previous)),
            eq(sessions.actorId, actor.id),
            isNull(sessions.endedAt),
          ),
        )
        .returning({ id: sessions.id });
      for (const v of ended)
        await tx.insert(audit).values({
          sessionId: v.id,
          action: "Simulation replaced",
          outcome: "ended",
        });
    }
    const [created] = await tx
      .insert(sessions)
      .values({
        tokenHash: hash(token),
        organizationId: actor.organizationId!,
        actorId: actor.id,
        employeeId: employee.id,
        actorName: actor.name ?? actor.email,
        employeeName: employee.name ?? employee.email,
        expiresAt,
      })
      .returning();
    if (!created) throw Error("Simulation could not start");
    await tx.insert(audit).values({
      sessionId: created.id,
      action: "Simulation started",
      outcome: "started",
    });
    return created;
  });
  return {
    token,
    simulation: {
      id: row.id,
      actorId: actor.id,
      employeeId: employee.id,
      employeeName: employee.name ?? employee.email,
      employeeEmail: employee.email,
      expiresAt: expiresAt.toISOString(),
    } satisfies EmployeeSimulation,
  };
}
export async function endEmployeeSimulation(
  actor: RequestUser | null,
  headers: Headers,
) {
  const token = simulationCookie(headers);
  if (!actor || !token) return;
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(sessions)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(sessions.tokenHash, hash(token)),
          eq(sessions.actorId, actor.id),
          isNull(sessions.endedAt),
        ),
      )
      .returning({ id: sessions.id });
    for (const row of rows)
      await tx.insert(audit).values({
        sessionId: row.id,
        action: "Simulation ended",
        outcome: "ended",
      });
  });
}
export async function recordSimulationAction(
  simulation: EmployeeSimulation,
  action: string,
) {
  const [row] = await db
    .insert(audit)
    .values({
      sessionId: simulation.id,
      action: action.slice(0, 512),
      outcome: "requested",
    })
    .returning({ id: audit.id });
  if (!row) throw Error("Simulation audit unavailable");
  return row.id;
}
export async function finishSimulationAction(
  id: string,
  outcome: "succeeded" | "failed",
) {
  await db.update(audit).set({ outcome }).where(eq(audit.id, id));
}
export async function simulationHistory(
  actor: RequestUser,
  employeeId: string,
) {
  if (!canSimulateEmployees(actor))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only Executive Accounts can view simulation history.",
    });
  const employee = await employeeUser(employeeId);
  if (employee?.organizationId !== actor.organizationId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Employee not found in your organization.",
    });
  const rows = await db
    .select({
      id: audit.id,
      actorName: sessions.actorName,
      action: audit.action,
      outcome: audit.outcome,
      createdAt: audit.createdAt,
    })
    .from(audit)
    .innerJoin(sessions, eq(sessions.id, audit.sessionId))
    .where(
      and(
        eq(sessions.organizationId, actor.organizationId!),
        eq(sessions.employeeId, employeeId),
      ),
    )
    .orderBy(desc(audit.createdAt))
    .limit(50);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
export async function assertEditorSimulation(id: string, employeeId: string) {
  const [row] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.id, id),
        isNull(sessions.endedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (row?.employeeId !== employeeId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Employee simulation ended. Reopen the document from your own account.",
    });
  const actor = await employeeUser(row.actorId),
    employee = await employeeUser(row.employeeId);
  assertSimulationTarget(actor, employee);
  if (!actor || !employee || row.organizationId !== actor.organizationId)
    throw new TRPCError({ code: "FORBIDDEN" });
  return {
    id: row.id,
    actorId: actor.id,
    employeeId: employee.id,
    employeeName: employee.name ?? employee.email,
    employeeEmail: employee.email,
    expiresAt: row.expiresAt.toISOString(),
  } satisfies EmployeeSimulation;
}
