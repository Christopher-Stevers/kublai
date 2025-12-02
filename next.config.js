/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // Increase body size limit for API routes to handle large file uploads (5GB)
  api: {
    bodyParser: {
      sizeLimit: "5gb",
    },
    responseLimit: false,
  },
  // For Next.js 13+ App Router, we need to configure route handlers differently
  experimental: {
    serverActions: {
      bodySizeLimit: "5gb",
    },
  },
};

export default config;
