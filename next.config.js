/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // For Next.js 13+ App Router, we need to configure route handlers differently
  experimental: {
    serverActions: {
      bodySizeLimit: "5gb",
    },
  },
  // Ignore ESLint errors during build (linting should be run separately)
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Ignore TypeScript errors during build (typecheck should be run separately)
  typescript: {
    ignoreBuildErrors: false, // Keep TypeScript checking during build
  },
};

export default config;
