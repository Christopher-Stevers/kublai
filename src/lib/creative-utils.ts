/**
 * Helper functions for working with creatives
 */

interface Creative {
  id: string;
  fileName: string;
  fileType: string;
  filePath: string;
  userId: string;
}

/**
 * Generate URL for serving creative files (images and videos)
 * @param creative - Creative object with filePath and userId
 * @returns URL to access the creative file, or null if invalid
 */
export function getCreativeImageUrl(creative: Creative): string | null {
  if (!creative.filePath || !creative.userId) {
    return null;
  }

  // Extract filename from filePath (e.g., "uploads/userId/filename" -> "filename")
  const filename = creative.filePath.split("/").pop();
  if (!filename) {
    return null;
  }

  return `/api/files/${creative.userId}/${filename}`;
}

/**
 * Check if creative is an image type
 */
export function isImageCreative(creative: { fileType: string }): boolean {
  return creative.fileType === "image";
}

/**
 * Check if creative is a video type
 */
export function isVideoCreative(creative: { fileType: string }): boolean {
  return creative.fileType === "video";
}

