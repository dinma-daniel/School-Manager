import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Each UI style under review runs as its own dev server, and next dev locks
  // its build folder — so each needs a folder of its own. Unset, it's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
