import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pins the workspace root to this directory. Without this, Turbopack
  // walks upward looking for lockfiles and can pick a stray sibling
  // package-lock.json outside the repo (e.g. in the user's home directory)
  // as the root, which breaks module resolution ("Can't resolve
  // 'tailwindcss'") since node_modules actually lives here.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
