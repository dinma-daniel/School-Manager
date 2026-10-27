/**
 * Reading a page the way a browser shows it, for course lists a site builds
 * with JavaScript. UW's graduate directory is an empty <app-root> until its
 * script fetches 533 programmes; plain HTML has none of them.
 *
 * A fallback, not the default: a render takes seconds where a fetch takes a
 * fraction of one, so it's only used on pages that look like an app shell.
 * It drives a browser already on the machine — Chrome, then Edge, or whatever
 * BROWSER_PATH names — rather than downloading one. With none to be found it
 * stays off, and the app reads plain HTML as before.
 */

import type { Browser } from "playwright-core";

/** The longest a render may take, start to finish. */
const RENDER_TIMEOUT_MS = 25_000;
/** How long the list may sit unchanged before we call it loaded. */
const SETTLE_MS = 1_500;
/** Shut the browser once nothing has used it for this long. */
const IDLE_CLOSE_MS = 60_000;
/** Pages rendering at once. A blocked site sends every fetch here, in batches. */
const MAX_OPEN_PAGES = 3;

let open = 0;
const waiting: (() => void)[] = [];
async function slot(): Promise<() => void> {
  if (open >= MAX_OPEN_PAGES) await new Promise<void>((resolve) => waiting.push(resolve));
  open++;
  return () => {
    open--;
    waiting.shift()?.();
  };
}

let browser: Promise<Browser | null> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let warned = false;

async function launch(): Promise<Browser | null> {
  const { chromium } = await import("playwright-core");
  const attempts = process.env.BROWSER_PATH
    ? [{ executablePath: process.env.BROWSER_PATH }]
    : [{ channel: "chrome" }, { channel: "msedge" }];
  for (const options of attempts) {
    try {
      return await chromium.launch({ ...options, headless: true });
    } catch {
      // Not installed under that name; try the next.
    }
  }
  if (!warned) {
    warned = true;
    console.warn("[render] No Chrome or Edge found (set BROWSER_PATH) — JavaScript-built course lists won't be read.");
  }
  return null;
}

function keepAlive() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const open = await browser;
    browser = null;
    await open?.close().catch(() => {});
  }, IDLE_CLOSE_MS);
}

/**
 * Whether a page's HTML is a shell its scripts fill in: an empty app root
 * (<app-root>, <div id="root">), or an empty custom element where the content
 * should be. Ordinary pages with a few scripts don't count — most do.
 */
export function looksScripted(html: string): boolean {
  if (/<(app-root|[a-z]+-[a-z0-9-]+)\b[^>]*>\s*<\/\1>/i.test(html)) return true;
  if (/<div\b[^>]*\bid\s*=\s*["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(html)) return true;
  return /\bng-app\b|\bng-version\b/i.test(html) && /\{\{[^}]+\}\}/.test(html);
}

/**
 * The page as it stands once its scripts have run and its content stopped
 * changing, or null if there's no browser to render it with, or the site
 * refused the browser too. A refusal is final: a bot challenge ("Just a
 * moment…") is the site saying no, and we don't try to get past it.
 */
export async function renderPage(url: string): Promise<{ html: string; url: string } | null> {
  browser ??= launch();
  const running = await browser;
  if (!running) return null;
  keepAlive();

  const release = await slot();
  const context = await running.newContext({ locale: "en-GB", javaScriptEnabled: true });
  try {
    const page = await context.newPage();
    // Pictures, fonts and video change nothing we read.
    await page.route("**/*", (route) =>
      ["image", "font", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue(),
    );
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
  } catch {
    return null;
  } finally {
    await context.close().catch(() => {});
    release();
    keepAlive();
  }
}
