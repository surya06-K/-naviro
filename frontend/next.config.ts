import type { NextConfig } from "next";

const shouldIgnoreBuildErrors =
  process.env.NEXT_IGNORE_BUILD_ERRORS === "true";

const nextConfig: NextConfig = {
  turbopack: {
    // Prevent Turbopack from inferring a higher-level workspace root (which can
    // trip over locked-down directories on Windows).
    root: __dirname,
  },
  typescript: {
    // Optional escape hatch for locked-down Windows environments.
    // Prefer leaving this off (default) for deploys/CI.
    ignoreBuildErrors: shouldIgnoreBuildErrors,
  },
};

export default nextConfig;
