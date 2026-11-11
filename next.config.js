/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import { ForemanBundleStats } from "./scripts/release/bundle-stats.cjs";

/** @type {import("next").NextConfig} */
const config = {
  webpack(config, { dev, isServer }) {
    if (!dev && !isServer && process.env.RELEASE_BUNDLE_STATS === "1")
      config.plugins.push(new ForemanBundleStats());
    return config;
  },
  generateBuildId: async () => process.env.RELEASE_BUILD_ID ?? null,
  // CI and local verification can build beside the live server instead of
  // replacing the .next directory that `next start` is currently serving.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // For Next.js 13+ App Router, we need to configure route handlers differently
  experimental: {
    // Keep visited page segments for five minutes in the client router.
    // Account changes must clear the router and account-scoped query memory.
    staleTimes: { dynamic: 300, static: 300 },
    // Forward complete 50 MB document uploads plus multipart metadata.
    // Each route continues to enforce its own file and request limits.
    proxyClientMaxBodySize: 51 * 1024 * 1024,
    serverActions: {
      bodySizeLimit: "5gb",
    },
  },
  // Ignore ESLint errors during build (linting should be run separately)

  // Ignore TypeScript errors during build (typecheck should be run separately)
  typescript: {
    tsconfigPath: process.env.NEXT_TSCONFIG_PATH ?? "tsconfig.json",
    ignoreBuildErrors: false, // Keep TypeScript checking during build
  },
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "node:sqlite"],
  async redirects() {
    return [
      { source: "/dashboard/jobs/:path*", destination: "/jobs/:path*", permanent: true },
      { source: "/dashboard/:path*", destination: "/jobs/:path*", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/foremanhq-release-assets.json",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
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
