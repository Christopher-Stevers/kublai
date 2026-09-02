/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // CI and local verification can build beside the live server instead of
  // replacing the .next directory that `next start` is currently serving.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // For Next.js 13+ App Router, we need to configure route handlers differently
  experimental: {
    serverActions: {
      bodySizeLimit: "5gb",
    },
  },
  // Ignore ESLint errors during build (linting should be run separately)

  // Ignore TypeScript errors during build (typecheck should be run separately)
  typescript: {
    ignoreBuildErrors: false, // Keep TypeScript checking during build
  },
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "node:sqlite"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      {
        source: "/offline.html",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default config;
