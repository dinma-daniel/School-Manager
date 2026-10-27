import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Each UI style under review runs as its own dev server, and next dev locks
  // its build folder — so each needs a folder of its own. Unset, it's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // next dev refuses its dev-only resources (HMR, client runtime) to any
  // origin but localhost, so the page never hydrates through a tunnel.
  // Drives a local browser binary; bundling it breaks its own module loading.
  serverExternalPackages: ["playwright-core"],
  allowedDevOrigins:["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.app"],
};

export default nextConfig;
