import { TRPCError } from "@trpc/server";
import { userCan } from "~/server/auth/permissions";
import { assertDocumentAccess } from "~/server/documents/access";
import { jobIdSchema } from "~/server/documents/contracts";
import {
  assertSameOrigin,
  documentHttpError,
  readBoundedBody,
} from "~/server/documents/http";
import {
  PAGE_CHECK_BYTES,
  readCapturedPage,
} from "~/server/packing-slips/page-check";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** The text of one page the scanner just captured (`image/jpeg` body), so it
 * can count the slip's printed page numbers before the scan is saved. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const jobId = jobIdSchema.parse(
      new URL(request.url).searchParams.get("jobId"),
    );
    const { userId } = await getRequestIdentity(request.headers, { request });
    const access = await assertDocumentAccess(userId, jobId);
    if (!userCan(access.user, "orders.receive"))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Order receiving permission is required.",
      });
    if (
      !/^image\/(?:jpeg|png)$/.test(
        request.headers.get("content-type")?.split(";")[0]?.trim() ?? "",
      )
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Send a JPEG or PNG page.",
      });
    const body = await readBoundedBody(request, PAGE_CHECK_BYTES);
    if (!body.length)
      throw new TRPCError({ code: "BAD_REQUEST", message: "Send a page." });
    return Response.json(
      { text: await readCapturedPage(new Uint8Array(body)) },
      { headers },
    );
  } catch (error) {
    return documentHttpError(error);
  }
}
