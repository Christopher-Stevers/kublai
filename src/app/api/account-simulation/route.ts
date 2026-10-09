import { NextResponse } from "next/server";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getAuthenticatedIdentity } from "~/server/utils/get-request-identity";
import {
  assertSameOrigin,
  readBoundedBody,
  documentHttpError,
} from "~/server/documents/http";
import { SIMULATION_COOKIE } from "~/lib/employee-simulation";
import {
  startEmployeeSimulation,
  endEmployeeSimulation,
  resolveEmployeeSimulation,
  simulationHistory,
  SIMULATION_DURATION_SECONDS,
} from "~/server/simulation/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const { user } = await getAuthenticatedIdentity(request.headers, {
      allowDev: true,
    });
    if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
    const employeeId = new URL(request.url).searchParams.get("employeeId");
    if (employeeId)
      return NextResponse.json(
        { history: await simulationHistory(user, employeeId) },
        { headers },
      );
    const resolved = await resolveEmployeeSimulation(request.headers, user);
    return NextResponse.json(
      {
        simulation: resolved?.simulation ?? null,
        view: resolved?.simulation.id ?? `account:${user.id}`,
      },
      { headers },
    );
  } catch (error) {
    return documentHttpError(error);
  }
}
const action = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      employeeId: z.string().min(1).max(255),
    })
    .strict(),
  z.object({ action: z.literal("end") }).strict(),
]);
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Send a JSON simulation request.",
      });
    const { user } = await getAuthenticatedIdentity(request.headers, {
      allowDev: true,
    });
    if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
    let input: z.infer<typeof action>;
    try {
      input = action.parse(
        JSON.parse((await readBoundedBody(request, 2048)).toString("utf8")),
      );
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid simulation request.",
        });
      throw error;
    }
    if (input.action === "end") {
      await endEmployeeSimulation(user, request.headers);
      const response = NextResponse.json({ ok: true }, { headers });
      response.cookies.delete(SIMULATION_COOKIE);
      return response;
    }
    const result = await startEmployeeSimulation(
      user,
      input.employeeId,
      request.headers,
    );
    const response = NextResponse.json(
      { simulation: result.simulation },
      { headers },
    );
    response.cookies.set(SIMULATION_COOKIE, result.token, {
      httpOnly: true,
      secure:
        new URL(request.url).protocol === "https:" ||
        request.headers.get("x-forwarded-proto") === "https",
      sameSite: "lax",
      path: "/",
      maxAge: SIMULATION_DURATION_SECONDS,
    });
    return response;
  } catch (error) {
    return documentHttpError(error);
  }
}
