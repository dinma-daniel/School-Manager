import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The classic look runs as its own dev server (scripts/dev-ui.mjs), and next
  // dev locks its build folder — so each needs a folder of its own. Unset, it's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Drives a local browser binary; bundling it breaks its own module loading.
  serverExternalPackages: ["playwright-core"],
  // next dev refuses its dev-only resources (HMR, client runtime) to any
  // origin but localhost, so the page never hydrates through a tunnel.
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.app"],
};

export default nextConfig;
