import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The classic look runs as its own dev server (scripts/dev-ui.mjs), and next
  // dev locks its build folder — so each needs a folder of its own. Unset, it's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Drive a browser binary; bundling them breaks their own module loading.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  // The serverless Chromium is unpacked at run time from these compressed
  // files, which nothing imports — so tracing alone would leave them behind.
  outputFileTracingIncludes: {
    "/api/programmes": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/extract": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  // next dev refuses its dev-only resources (HMR, client runtime) to any
  // origin but localhost, so the page never hydrates through a tunnel.
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.app"],
};

export default nextConfig;
