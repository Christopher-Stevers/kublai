/**
 * Simple in-memory rate limiter
 * For production, consider using Redis-based rate limiting (e.g., @upstash/ratelimit)
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Rate limit configuration
 */
const RATE_LIMIT_CONFIG = {
  maxUploads: 10, // Maximum uploads
  windowMs: 60 * 60 * 1000, // 1 hour in milliseconds
};

/**
 * Check if a user has exceeded rate limit
 * @param userId - User ID to check
 * @returns true if within limit, false if exceeded
 */
export function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(userId);

  if (!entry || now > entry.resetTime) {
    // Create new entry or reset expired entry
    rateLimitStore.set(userId, {
      count: 1,
      resetTime: now + RATE_LIMIT_CONFIG.windowMs,
    });
    return {
      allowed: true,
      remaining: RATE_LIMIT_CONFIG.maxUploads - 1,
      resetAt: now + RATE_LIMIT_CONFIG.windowMs,
    };
  }

  if (entry.count >= RATE_LIMIT_CONFIG.maxUploads) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetTime,
    };
  }

  // Increment count
  entry.count++;
  rateLimitStore.set(userId, entry);

  return {
    allowed: true,
    remaining: RATE_LIMIT_CONFIG.maxUploads - entry.count,
    resetAt: entry.resetTime,
  };
}

/**
 * Clean up expired entries (call periodically to prevent memory leaks)
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

// Clean up expired entries every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
}

