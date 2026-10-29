/**
 * Reading a page the way a browser shows it, for course lists a site builds
 * with JavaScript. UW's graduate directory is an empty <app-root> until its
 * script fetches 533 programmes; plain HTML has none of them.
 *
 * A fallback, not the default: a render takes seconds where a fetch takes a
 * fraction of one, so it's only used on pages that look like an app shell, or
 * that turn away plain fetches. Locally it drives a browser already on the
 * machine — Chrome, then Edge, or whatever BROWSER_PATH names. On Vercel, which
 * has none, it uses @sparticuz/chromium, a Chromium build made for serverless.
 * With no browser at all it stays off, and the app reads plain HTML as before.
 *
 * The page's own scripts run, so every request it makes is checked the same
 * way a pasted link is: nothing reaches a private or internal address.
 */

import type { Browser } from "playwright-core";
import { assertPublic, htmlToText } from "./scrape";

/** The longest a render may take, start to finish. */
const RENDER_TIMEOUT_MS = 20_000;
/** How long the list may sit unchanged before we call it loaded. */
const SETTLE_MS = 1_500;
/** Shut the browser once nothing has used it for this long. */
const IDLE_CLOSE_MS = 60_000;
/** Pages rendering at once. A blocked site sends every fetch here, in batches. */
const MAX_OPEN_PAGES = 3;

let open = 0;
const waiting: (() => void)[] = [];
/** A free slot, or a wait for one. A slot that's given up goes straight to whoever is waiting. */
function slot(): Promise<() => void> {
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else open--;
  };
  if (open < MAX_OPEN_PAGES) {
    open++;
    return Promise.resolve(release);
  }
  return new Promise((resolve) => waiting.push(() => resolve(release)));
}

/** Running on Vercel or AWS Lambda, where the bundled serverless Chromium is the only browser. */
const SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

let browser: Promise<Browser | null> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let warned = false;

async function launch(): Promise<Browser | null> {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    return null; // Not installed: the fallback is simply off.
  }
  const attempts: Parameters<typeof chromium.launch>[0][] = [];
  if (process.env.BROWSER_PATH) {
    attempts.push({ executablePath: process.env.BROWSER_PATH });
  } else if (SERVERLESS) {
    // Vercel and Lambda have no browser of their own: use the Chromium build
    // made for them, unpacked from node_modules on first use.
    try {
      const { default: bundled } = await import("@sparticuz/chromium");
      attempts.push({ executablePath: await bundled.executablePath(), args: bundled.args });
    } catch (err) {
      console.warn("[render] Couldn't unpack the bundled Chromium:", err);
    }
  } else {
    attempts.push({ channel: "chrome" }, { channel: "msedge" });
  }
  for (const options of attempts) {
    try {
      const launched = await chromium.launch({ ...options, headless: true });
      // A browser that crashes or is closed isn't kept for the next request.
      launched.on("disconnected", () => forget(launched));
      return launched;
    } catch (err) {
      // Not installed under that name; try the next. On a server there's
      // only one, so say why it wouldn't start — that's what the logs need.
      if (SERVERLESS || process.env.BROWSER_PATH) console.warn("[render] Browser failed to start:", err);
    }
  }
  if (!warned) {
    warned = true;
    console.warn("[render] No browser available (set BROWSER_PATH) — JavaScript-built course lists won't be read.");
  }
  return null;
}

/** Drop the cached browser if it's this one, so the next render starts a fresh one. */
async function forget(which?: Browser) {
  const current = await browser;
  if (!which || current === which) browser = null;
}

function keepAlive() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const running = await browser;
    browser = null;
    await running?.close().catch(() => {});
  }, IDLE_CLOSE_MS);
}

/**
 * Whether a page's HTML is a shell its scripts fill in: an empty app root
 * (<app-root>, <div id="root">), or — on a page with little text of its own —
 * an empty custom element where the content should be. Plenty of ordinary
 * pages carry an empty <lite-youtube> or cookie widget; those don't count.
 */
export function looksScripted(html: string): boolean {
  if (/<app-root\b[^>]*>\s*<\/app-root>/i.test(html)) return true;
  if (/<div\b[^>]*\bid\s*=\s*["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(html)) return true;
  if (/\bng-app\b|\bng-version\b/i.test(html) && /\{\{[^}]+\}\}/.test(html)) return true;
  return /<([a-z]+-[a-z0-9-]+)\b[^>]*>\s*<\/\1>/i.test(html) && htmlToText(html).length < 4_000;
}

/**
 * The page as it stands once its scripts have run and its content stopped
 * changing, or null if there's no browser to render it with, the site refused
 * the browser too, or it ran out of time. A refusal is final: a bot challenge
 * ("Just a moment…") is the site saying no, and we don't try to get past it.
 */
export async function renderPage(url: string): Promise<{ html: string; url: string } | null> {
  browser ??= launch();
  const running = await browser;
  if (!running) return null;
  keepAlive();

  const release = await slot();
  let context: Awaited<ReturnType<Browser["newContext"]>> | null = null;
  // However the page behaves — a script that never yields included — the
  // render ends here, and closing the context cancels whatever was pending.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), RENDER_TIMEOUT_MS + 2_000);
  });
  try {
    context = await running.newContext({ locale: "en-GB", javaScriptEnabled: true });
    const work = load(context, url).catch(() => null);
    return await Promise.race([work, timeout]);
  } catch {
    // The browser went away under us; start afresh next time.
    await forget(running);
    return null;
  } finally {
    clearTimeout(timer);
    await context?.close().catch(() => {});
    release();
    keepAlive();
  }
}

async function load(context: Awaited<ReturnType<Browser["newContext"]>>, url: string) {
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const request = route.request();
    // Pictures, fonts and video change nothing we read.
    if (["image", "font", "media"].includes(request.resourceType())) return route.abort();
    try {
      await assertPublic(new URL(request.url()));
    } catch {
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  // Course lists don't need live sockets, and they'd skip the check above.
  await page.routeWebSocket(/.*/, (ws) => ws.close());

  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
  if (!response || response.status() >= 400) return null;
  // UW's list request takes several seconds, during which the page has one
  // link and looks settled — so first wait for the requests to stop…
  await page.waitForLoadState("networkidle", { timeout: Math.max(0, deadline - Date.now() - SETTLE_MS) }).catch(() => {});

  // …then for the number of links to stop climbing. Network-idle alone isn't
  // enough: analytics pings keep some pages "busy" until the timeout.
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const count = await page.evaluate(() => document.querySelectorAll("a[href]").length);
    if (count !== last) {
      last = count;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= SETTLE_MS && count > 0) {
      break;
    }
    await page.waitForTimeout(300);
  }
  return { html: await page.content(), url: page.url() };
}
