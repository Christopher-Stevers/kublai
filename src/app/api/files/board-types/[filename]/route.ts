import { type NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { existsSync } from "fs";
import { UPLOAD_DIR } from "~/server/utils/file-upload";

export const runtime = "nodejs";

// Board type images directory
const BOARD_TYPES_DIR = "board-types";

/**
 * Get the full file path for a board type image
 */
function getBoardTypeImagePath(filename: string): string {
  const baseDir = resolve(process.cwd(), UPLOAD_DIR);
  const boardTypesDir = resolve(baseDir, BOARD_TYPES_DIR);
  const filePath = resolve(boardTypesDir, filename);

  // Security check: ensure the resolved path is still within boardTypesDir
  if (!filePath.startsWith(boardTypesDir)) {
    throw new Error("Invalid file path: path traversal detected");
  }

  return filePath;
}

/**
 * Validate filename to prevent path traversal
 */
function validateFilename(filename: string): boolean {
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return false;
  }
  return true;
}

/**
 * GET endpoint to serve board type images
 * Public access - no authentication required
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ filename: string }> },
) {
  try {
    const params = await context.params;

    // Validate filename
    if (!validateFilename(params.filename)) {
      return new NextResponse("Invalid filename", { status: 400 });
    }

    // Get the full file path
    const filePath = getBoardTypeImagePath(params.filename);

    // Check if file exists on filesystem
    if (!existsSync(filePath)) {
      return new NextResponse("File not found", { status: 404 });
    }

    // Read and serve the file
    const fileBuffer = await readFile(filePath);

    // Determine content type from file extension
    const extension = params.filename.split(".").pop()?.toLowerCase();
    let contentType = "image/jpeg"; // default
    if (extension === "png") contentType = "image/png";
    else if (extension === "webp") contentType = "image/webp";
    else if (extension === "gif") contentType = "image/gif";
    else if (extension === "jpg" || extension === "jpeg") contentType = "image/jpeg";

    // Return the file with appropriate headers
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable", // Cache for 1 year
      },
    });
  } catch (error) {
    console.error("Error serving board type image:", error);
    return new NextResponse("Internal server error", { status: 500 });
  }
}

