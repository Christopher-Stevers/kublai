import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { creatives } from "~/server/db/schema";
import { getFilePath, validateUserId } from "~/server/utils/file-upload";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

export const runtime = "nodejs";

/**
 * Protected file serving route
 * Only allows users to access their own files (or admins to access any file)
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ userId: string; filename: string }> },
) {
  try {
    const params = await context.params;
    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const currentUserId = session.user.id;

    // Validate userId format to prevent path traversal
    if (!validateUserId(params.userId)) {
      return new NextResponse("Invalid user ID", { status: 400 });
    }

    // Validate filename (basic check)
    if (
      !params.filename ||
      params.filename.includes("..") ||
      params.filename.includes("/")
    ) {
      return new NextResponse("Invalid filename", { status: 400 });
    }

    // Check if user is accessing their own file or is an admin
    const isAdmin = session.user.role === "admin";
    if (currentUserId !== params.userId && !isAdmin) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Verify the file exists in the database
    // If admin, can access any file; if not, must belong to user
    const allUserCreatives = await db
      .select()
      .from(creatives)
      .where(eq(creatives.userId, params.userId));

    const matchingCreative = allUserCreatives.find((c) => {
      const storedFilename = c.filePath.split("/").pop();
      return storedFilename === params.filename;
    });

    if (!matchingCreative) {
      return new NextResponse("File not found", { status: 404 });
    }

    // Get the full file path

    const filePath = getFilePath(params.userId, params.filename);

    // Check if file exists on filesystem
    if (!existsSync(filePath)) {
      return new NextResponse("File not found on server", { status: 404 });
    }

    // Read and serve the file
    const fileBuffer = await readFile(filePath);

    // Determine content type from stored MIME type
    const contentType = matchingCreative.mimeType || "application/octet-stream";

    // Set appropriate headers
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", fileBuffer.length.toString());
    headers.set(
      "Content-Disposition",
      `inline; filename="${matchingCreative.fileName}"`,
    );

    // Security headers
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "private, max-age=3600"); // Cache for 1 hour

    return new NextResponse(fileBuffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("File serving error:", error);
    return new NextResponse("Internal server error", { status: 500 });
  }
}
