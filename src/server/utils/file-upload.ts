import { existsSync, mkdirSync, unlinkSync, readFileSync, chmodSync } from "fs";
import { join, resolve } from "path";
import { env } from "~/env";

/**
 * Allowed image MIME types
 */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/**
 * Allowed video MIME types
 */
export const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime", // .mov
  "video/x-msvideo", // .avi
  "video/webm",
] as const;

/**
 * All allowed MIME types
 */
export const ALLOWED_MIME_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
] as const;

/**
 * Maximum upload size in bytes (default 5GB for 10-minute video masters)
 */
export const MAX_UPLOAD_SIZE = Number.parseInt(
  env.MAX_UPLOAD_SIZE ?? "5368709120",
  10,
);

/**
 * Base upload directory
 */
export const UPLOAD_DIR = "uploads";

/**
 * Get the file type (image or video) from MIME type
 */
export function getFileTypeFromMimeType(mimeType: string): "image" | "video" {
  if (
    ALLOWED_IMAGE_TYPES.includes(
      mimeType as (typeof ALLOWED_IMAGE_TYPES)[number],
    )
  ) {
    return "image";
  }
  if (
    ALLOWED_VIDEO_TYPES.includes(
      mimeType as (typeof ALLOWED_VIDEO_TYPES)[number],
    )
  ) {
    return "video";
  }
  throw new Error(`Unsupported MIME type: ${mimeType}`);
}

/**
 * Validate file type by MIME type
 */
export function validateFileType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(
    mimeType as (typeof ALLOWED_MIME_TYPES)[number],
  );
}

/**
 * Validate file size
 */
export function validateFileSize(fileSize: number): boolean {
  return fileSize > 0 && fileSize <= MAX_UPLOAD_SIZE;
}

/**
 * Sanitize filename to prevent path traversal and other security issues
 */
export function sanitizeFilename(filename: string): string {
  // Remove path separators and other dangerous characters
  return filename
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\.\./g, "_")
    .trim();
}

/**
 * Generate a safe filename with UUID prefix
 */
export function generateSafeFilename(
  originalFilename: string,
  uuid: string,
): string {
  const sanitized = sanitizeFilename(originalFilename);
  return `${uuid}-${sanitized}`;
}

/**
 * Ensure the upload directory exists for a user
 * Validates userId and creates directory if it doesn't exist
 */
export function ensureUserUploadDir(userId: string): string {
  // getUserUploadDir will throw if userId is invalid
  const userDir = getUserUploadDir(userId);
  if (!existsSync(userDir)) {
    mkdirSync(userDir, { recursive: true });
    // Set directory permissions (owner read/write/execute only)
    try {
      chmodSync(userDir, 0o700);
    } catch {
      // Ignore chmod errors (Windows doesn't support Unix permissions the same way)
    }
  }
  return userDir;
}

/**
 * Get the full file path for a user's uploaded file
 */
export function getFilePath(userId: string, filename: string): string {
  return join(getUserUploadDir(userId), filename);
}

/**
 * Delete a file from the filesystem
 */
export function deleteFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (error) {
    console.error(`Failed to delete file ${filePath}:`, error);
    // Don't throw - file deletion failure shouldn't break the flow
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i] ?? ""}`;
}

/**
 * File signatures (magic numbers) for validation
 * Maps MIME types to their hex signatures at the start of files
 */
const FILE_SIGNATURES: Record<string, string[]> = {
  "image/jpeg": ["FFD8FF"],
  "image/jpg": ["FFD8FF"],
  "image/png": ["89504E47"],
  "image/webp": ["52494646"], // RIFF header, need to check for WEBP further in
  "image/gif": ["47494638", "47494639"], // GIF87a and GIF89a
  "video/mp4": ["00000020", "00000018", "0000001C"], // MP4 ftyp box variations
  "video/quicktime": ["00000020", "00000018"], // QuickTime ftyp box
  "video/webm": ["1A45DFA3"], // EBML header
  "video/x-msvideo": ["52494646"], // AVI uses RIFF, need additional validation
};

/**
 * MIME type to allowed file extensions mapping
 */
const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/jpg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "video/mp4": [".mp4"],
  "video/quicktime": [".mov"],
  "video/x-msvideo": [".avi"],
  "video/webm": [".webm"],
};

/**
 * Validate file extension matches MIME type
 */
export function validateExtension(filename: string, mimeType: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  const allowedExts = MIME_TO_EXTENSIONS[mimeType];
  if (!allowedExts) return false;
  return allowedExts.includes(ext);
}

/**
 * Validate file content using magic numbers/file signatures
 * Reads the first bytes of the file and checks against known signatures
 */
export function validateFileContent(
  filePath: string,
  expectedMimeType: string,
): boolean {
  try {
    // Read first 20 bytes (enough for most signatures and special cases)
    const fullBuffer = readFileSync(filePath);
    const buffer = fullBuffer.subarray(0, Math.min(20, fullBuffer.length));
    const hex = buffer.toString("hex").toUpperCase();
    const signatures = FILE_SIGNATURES[expectedMimeType];

    if (!signatures) return false;

    // Check if file starts with any known signature for this MIME type
    const matchesSignature = signatures.some((sig) => hex.startsWith(sig));

    // Special handling for WebP (RIFF...WEBP)
    if (expectedMimeType === "image/webp" && hex.startsWith("52494646")) {
      // Check for WEBP in the hex string
      return hex.includes("57454250"); // "WEBP" in hex
    }

    // Special handling for AVI (RIFF...AVI)
    if (expectedMimeType === "video/x-msvideo" && hex.startsWith("52494646")) {
      return hex.includes("41564920"); // "AVI " in hex
    }

    // Special handling for MP4/QuickTime (ftyp box)
    // QuickTime/MOV files can have any box size, so we check for "ftyp" at byte 4
    if (
      expectedMimeType === "video/mp4" ||
      expectedMimeType === "video/quicktime"
    ) {
      // Check for ftyp box starting at byte 4 (regardless of box size)
      if (buffer.length >= 12) {
        const ftypBuffer = buffer.subarray(4, 8);
        const ftypCheck = ftypBuffer.toString("ascii");
        if (ftypCheck === "ftyp") {
          // For QuickTime, also check for QuickTime brand identifiers
          if (expectedMimeType === "video/quicktime") {
            // Check bytes 8-12 for QuickTime brand (qt  , qt 2, etc.)
            const brandBuffer = buffer.subarray(8, 12);
            const brandCheck = brandBuffer.toString("ascii");
            // QuickTime files typically have "qt  " or other qt-related brands
            return (
              brandCheck.startsWith("qt") ||
              brandCheck === "moov" ||
              brandCheck === "mdat" ||
              // Also allow MP4 brands that QuickTime can use
              brandCheck === "isom" ||
              brandCheck === "mp41" ||
              brandCheck === "mp42"
            );
          }
          // For MP4, just having ftyp is enough
          return true;
        }
      }
      // Fall back to signature check for MP4 (but not QuickTime)
      if (expectedMimeType === "video/mp4") {
        return matchesSignature;
      }
      // QuickTime should always have ftyp, so return false if not found
      return false;
    }

    return matchesSignature;
  } catch (error) {
    console.error("Error validating file content:", error);
    return false;
  }
}

/**
 * Validate userId format to prevent path traversal
 */
export function validateUserId(userId: string): boolean {
  // Only allow alphanumeric, hyphens, underscores, and dots
  // UUIDs typically use hyphens, so we allow those
  return (
    /^[a-zA-Z0-9._-]+$/.test(userId) &&
    userId.length > 0 &&
    userId.length <= 255
  );
}

/**
 * Get the upload directory path for a specific user with path traversal protection
 */
export function getUserUploadDir(userId: string): string {
  // Validate userId first
  if (!validateUserId(userId)) {
    throw new Error("Invalid user ID format");
  }

  const baseDir = resolve(process.cwd(), UPLOAD_DIR);
  const userDir = resolve(baseDir, userId);

  // Ensure resolved path is still within baseDir (prevent path traversal)
  console.log("Uploading to ", userDir, baseDir, "is base dir");
  // Normalize paths and ensure userDir is a subdirectory of baseDir (cross-platform)
  const relative = userDir.substring(baseDir.length);
  if (
    baseDir !== userDir && // allow base dir itself for some reason? consistent with previous
    (
      // Not a subdirectory if relative does not start with path separator
      !(
        relative.startsWith("/") ||
        relative.startsWith("\\")
      )
    )
  ) {
    throw new Error("Invalid upload path: path traversal detected");
  }

  return userDir;
}

/**
 * Check available disk space
 * Returns true if there's enough space (requires 2x the file size available)
 * Note: This is a simplified check. For production on Windows, consider using
 * a library like 'check-disk-space' for accurate cross-platform disk space checking
 */
export async function checkDiskSpace(
  requiredBytes: number,
): Promise<{ available: boolean; availableBytes: number }> {
  try {
    // Try to use Node.js built-in (works on Unix systems)
    // For Windows, we'll need to handle differently or use a library
    const { statfs } = await import("fs/promises");
    const stats = await statfs(process.cwd());
    const availableBytes = stats.bavail * stats.bsize;
    // Require at least 2x the file size available as a safety margin
    return {
      available: availableBytes > requiredBytes * 2,
      availableBytes,
    };
  } catch (error) {
    // On Windows or if statfs is not available, we can't reliably check disk space
    // Log a warning but allow upload (monitoring should catch disk space issues)
    console.warn(
      "Could not check disk space (may be Windows or permission issue). Consider monitoring disk usage:",
      error,
    );
    // For Windows/unsupported systems, allow upload but recommend monitoring
    // In production, consider using 'check-disk-space' npm package for cross-platform support
    return { available: true, availableBytes: Number.MAX_SAFE_INTEGER };
  }
}
