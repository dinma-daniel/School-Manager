import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The classic look runs as its own dev server (scripts/dev-ui.mjs), and next
  // dev locks its build folder — so each needs a folder of its own. Unset, it's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Drive a browser binary; bundling them breaks their own module loading.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  // Files read at run time rather than imported, so tracing alone leaves them
  // behind: the serverless Chromium's compressed binaries, and playwright-core's
  // browsers.json (without it, playwright-core won't even load).
  outputFileTracingIncludes: {
    "/api/programmes": ["./node_modules/@sparticuz/chromium/bin/**", "./node_modules/playwright-core/**"],
    "/api/extract": ["./node_modules/@sparticuz/chromium/bin/**", "./node_modules/playwright-core/**"],
  },
  // next dev refuses its dev-only resources (HMR, client runtime) to any
  // origin but localhost, so the page never hydrates through a tunnel.
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.app"],
};

export default nextConfig;
