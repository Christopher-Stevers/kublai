import { auth } from "~/server/auth";
import {
  checkDiskSpace,
  generateSafeFilename,
  getFileTypeFromMimeType,
  UPLOAD_DIR,
  validateExtension,
  validateFileContent,
  validateFileSize,
  validateFileType,
} from "~/server/utils/file-upload";
import { writeFile, chmod } from "fs/promises";
import { mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ALLOWED_IMAGE_TYPES } from "~/server/utils/file-upload";

export const runtime = "nodejs"; // Use Node.js runtime for file system operations

// Board type images directory
const BOARD_TYPES_DIR = "board-types";

/**
 * Get the upload directory for board type images
 */
function getBoardTypesUploadDir(): string {
  const baseDir = resolve(process.cwd(), UPLOAD_DIR);
  const boardTypesDir = resolve(baseDir, BOARD_TYPES_DIR);
  return boardTypesDir;
}

/**
 * Ensure the board types upload directory exists
 */
function ensureBoardTypesUploadDir(): string {
  const boardTypesDir = getBoardTypesUploadDir();
  if (!existsSync(boardTypesDir)) {
    mkdirSync(boardTypesDir, { recursive: true });
    // Set directory permissions (owner read/write/execute only)
    try {
      chmod(boardTypesDir, 0o700);
    } catch {
      // Ignore chmod errors (Windows doesn't support Unix permissions the same way)
    }
  }
  return boardTypesDir;
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication and admin role
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type (images only for board types)
    const mimeType = file.type;
    if (!ALLOWED_IMAGE_TYPES.includes(mimeType as (typeof ALLOWED_IMAGE_TYPES)[number])) {
      return NextResponse.json(
        { error: "Invalid file type. Only images are allowed (JPEG, PNG, WebP, GIF)." },
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

    // Validate file size (10MB limit for board type images)
    const fileSize = file.size;
    const MAX_BOARD_TYPE_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
    if (fileSize > MAX_BOARD_TYPE_IMAGE_SIZE) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size is 10MB`,
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

    // Ensure board types upload directory exists
    const boardTypesDir = ensureBoardTypesUploadDir();
    const filePath = join(boardTypesDir, safeFilename);

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

    // Return the URL path for the image
    const imageUrl = `/api/files/board-types/${safeFilename}`;

    return NextResponse.json(
      {
        success: true,
        imageUrl,
      },
      { status: 200 },
    );
  } catch (error) {
    // Log full error for debugging but don't expose to client
    console.error("Board type image upload error:", error);

    // Return generic error message to prevent information leakage
    return NextResponse.json(
      { error: "Failed to upload file. Please try again." },
      { status: 500 },
    );
  }
}

