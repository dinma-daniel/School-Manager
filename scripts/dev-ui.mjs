// Run a side-by-side overlay of an older UI style.
//
//   node scripts/dev-ui.mjs classic     → http://localhost:3101
//
// Each style gets its own build folder, because next dev locks the one it uses
// and two servers can't share it.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const PORTS = { classic: 3101 };
const ui = process.argv[2];
if (!(ui in PORTS)) {
  console.error(`Usage: node scripts/dev-ui.mjs <${Object.keys(PORTS).join("|")}>`);
  process.exit(1);
}

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "dev", "--port", String(PORTS[ui])], {
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_UI: ui, NEXT_DIST_DIR: `.next-${ui}` },
});
child.on("exit", (code) => process.exit(code ?? 0));
