import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { creatives } from "~/server/db/schema";
import {
  checkDiskSpace,
  ensureUserUploadDir,
  generateSafeFilename,
  getFileTypeFromMimeType,
  UPLOAD_DIR,
  validateExtension,
  validateFileContent,
  validateFileSize,
  validateFileType,
  validateUserId,
} from "~/server/utils/file-upload";
import { checkRateLimit } from "~/server/utils/rate-limit";
import { writeFile, chmod } from "fs/promises";
import { join } from "path";
import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs"; // Use Node.js runtime for file system operations

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Validate userId format to prevent path traversal
    if (!validateUserId(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    // Check rate limit
    const rateLimitResult = checkRateLimit(userId);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded. Please try again later.",
          retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
        },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000).toString(),
            "X-RateLimit-Limit": "10",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": rateLimitResult.resetAt.toString(),
          },
        },
      );
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const mimeType = file.type;
    if (!validateFileType(mimeType)) {
      return NextResponse.json(
        { error: "Invalid file type. Only images and videos are allowed." },
        { status: 400 },
      );
    }

    // Validate file extension matches MIME type
    if (!validateExtension(file.name, mimeType)) {
      return NextResponse.json(
        { error: "File extension does not match file type." },
        { status: 400 },
      );
    }

    // Validate file size
    const fileSize = file.size;
    if (!validateFileSize(fileSize)) {
      const maxSizeGB = Math.round((5 * 1024 * 1024 * 1024) / (1024 * 1024 * 1024));
      return NextResponse.json(
        {
          error: `File too large. Maximum size is ${maxSizeGB}GB`,
        },
        { status: 400 },
      );
    }

    // Check disk space before processing
    const diskSpaceCheck = await checkDiskSpace(fileSize);
    if (!diskSpaceCheck.available) {
      return NextResponse.json(
        { error: "Insufficient disk space available" },
        { status: 507 }, // 507 Insufficient Storage
      );
    }

    // Generate unique filename
    const uuid = randomUUID();
    const safeFilename = generateSafeFilename(file.name, uuid);

    // Ensure user upload directory exists
    const userDir = ensureUserUploadDir(userId);
    const filePath = join(userDir, safeFilename);

    // Get file type (image or video)
    const fileType = getFileTypeFromMimeType(mimeType);

    // Convert file to buffer and save
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(filePath, buffer);

    // Set secure file permissions (owner read/write only)
    try {
      await chmod(filePath, 0o600);
    } catch (chmodError) {
      // On Windows, chmod may not work as expected, but that's okay
      console.warn("Could not set file permissions (may be Windows):", chmodError);
    }

    // Validate file content using magic numbers (after saving to disk)
    if (!validateFileContent(filePath, mimeType)) {
      // Delete the file if content doesn't match
      const { unlink } = await import("fs/promises");
      await unlink(filePath).catch(() => {
        // Ignore deletion errors
      });
      return NextResponse.json(
        { error: "File content does not match declared file type" },
        { status: 400 },
      );
    }

    // Create database record
    // Store relative path from project root (e.g., "uploads/userId/filename")
    const relativePath = join(UPLOAD_DIR, userId, safeFilename).replace(/\\/g, "/");
    const [creative] = await db
      .insert(creatives)
      .values({
        userId,
        fileName: file.name, // Store original filename
        fileType,
        filePath: relativePath, // Store relative path
        fileSize,
        mimeType,
      })
      .returning();

    if (!creative) {
      // If database insert failed, clean up the file
      const { unlink } = await import("fs/promises");
      await unlink(filePath).catch(() => {
        // Ignore deletion errors
      });
      return NextResponse.json(
        { error: "Failed to save file record" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        creative: {
          id: creative.id,
          fileName: creative.fileName,
          fileType: creative.fileType,
          fileSize: creative.fileSize,
          mimeType: creative.mimeType,
          uploadDate: creative.uploadDate,
        },
      },
      {
        headers: {
          "X-RateLimit-Limit": "10",
          "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
          "X-RateLimit-Reset": rateLimitResult.resetAt.toString(),
        },
      },
    );
  } catch (error) {
    // Log full error for debugging but don't expose to client
    console.error("Upload error:", error);
    
    // Return generic error message to prevent information leakage
    return NextResponse.json(
      { error: "Failed to upload file. Please try again." },
      { status: 500 },
    );
  }
}

