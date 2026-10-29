/**
 * Fetching and flattening admissions pages.
 *
 * University sites scatter the answer across several pages — the course page
 * says "see entry requirements", which says "see English language", which
 * says "see fees". So we read the page the user gave us, then follow a few
 * same-site links whose anchor text looks like application information, and
 * hand the model everything at once.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PAGE_BUDGET = 4; // extra pages beyond the one the user pasted
const MAX_BYTES = 2_000_000;
const DEFAULT_MAX_CHARS = 120_000;
/** Under this, with nothing admissions-shaped in it, we got a shell not a page. */
const THIN_PAGE_CHARS = 2_500;

/** Words that any page worth extracting from will use at least a couple of. */
const ADMISSIONS_SIGNALS = [
  /how to apply|apply now|application/i,
  /entry requirement|admission|eligib/i,
  /deadline|closing date|key dates/i,
  /tuition|fees|cost/i,
  /scholarship|bursar|funding|financial aid/i,
  /qualification|grades|transcript|personal statement/i,
];
const FETCH_TIMEOUT_MS = 15_000;
/** Hops a link may redirect through before we give up on it. */
const MAX_REDIRECTS = 8;

/**
 * Who we say we are.
 *
 * Claiming to be Chrome backfires: several university sites run WAF rules
 * against Chrome user-agents that don't complete a browser handshake, and
 * refuse with a 403 — DAAD does exactly this, while allowing curl, Firefox and
 * an honest bot string through. So we identify ourselves plainly first, and
 * only fall back to a browser string for the rarer sites that block unknown
 * agents instead.
 */
const UA_LADDER = [
  "ApplicationPlanner/1.0 (+student project; reads public admissions pages)",
  "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
];

/** Anchor text worth following, roughly in order of how often it holds the answer. */
const LINK_HINTS: [RegExp, number][] = [
  [/application fee/i, 10],
  [/how to apply|apply now|application process|start your application|zulassung|bewerbung|anmeldung|candidature|inscription|admisi[oó]n/i, 10],
  [/entry requirement|admission requirement|requirements|eligibility|voraussetzung|aufnahmeverfahren|conditions d.admission|requisitos/i, 9],
  [/scholarship|bursar|financial aid|funding|grant|stipendi|förderung|bourse|beca/i, 9],
  [/tuition|fees|cost of|studienbeitr|gebühr|kosten|frais|tasas/i, 8],
  [/deadline|key dates|important dates|application dates|fristen|termine|dates limites|plazos/i, 8],
  [/international (students|applicants)/i, 6],
  [/freshman|first[- ]year applicant|transfer (student|applicant)|mature student/i, 6],
  [/english language|language requirement|deutschkenntnis|sprachnachweis|sprachkenntnis/i, 6],
  [/admissions?$/i, 5],
  [/undergraduate|postgraduate|graduate admission/i, 4],
];

export class ScrapeError extends Error {}

/**
 * A page we may not read rather than one that went wrong: it wants a login,
 * or the site lets only real browsers in. The UI explains these differently
 * from an error — nothing is broken, and the user can still open the page.
 */
export class AccessError extends ScrapeError {
  readonly kind: "login" | "blocked";
  readonly url: string;
  constructor(kind: "login" | "blocked", url: string) {
    super(
      kind === "login"
        ? "That page asks you to sign in first, so the app can't read it."
        : "That site only lets real web browsers in, so the app can't read it.",
    );
    this.kind = kind;
    this.url = url;
  }
}

/** Addresses of single sign-on systems and login routes. */
const LOGIN_HOST =
  /^(login|logon|signin|sso|idp|auth|cas|weblogin|shibboleth|accounts?)\.|(microsoftonline\.com|okta\.com|auth0\.com|onelogin\.com|duosecurity\.com|accounts\.google\.com)$/i;
/**
 * Sign-in routes, and the sign-up and portal pages that come before them.
 * Application portals are often drawn entirely by JavaScript — American's
 * Salesforce one is 70 characters of HTML — so the address is all there is to
 * go on.
 */
const LOGIN_PATH =
  /\/(login|log-in|logon|signin|sign-in|sso|saml2?|oauth2?|authorize|cas\/login|idp\/|account\/login|auth\/realms|create-?account|new-?account|register|sign-?up|applicant-?portal|admissions?-?portal)\b/i;
/** Hosted platforms whose sites at a university are application portals: Salesforce Experience Cloud, Liaison's CAS. */
const PORTAL_HOST = /\.(my\.site\.com|force\.com|liaisoncas\.com)$/i;
/** What a login landing page says when the form itself is drawn by JavaScript. */
const LOGIN_PROMPT =
  /\b(log ?in|sign ?in) (below|here )?to (apply|continue|access|view|start|proceed)|\bcreate an account\b|\bfirst[- ]time (users?|applicants?)\b|\breturning (users?|applicants?)\b|\bforgot (your )?password\b/i;

/**
 * A page that's a sign-in screen rather than content. Judged on where we
 * landed and on the page being short: plenty of real pages carry a "Log in"
 * link in their header, but a page that is mostly a password box or a "log in
 * to apply" prompt has nothing to read.
 */
function isLoginWall(html: string, landed: string): boolean {
  let url: URL;
  try {
    url = new URL(landed);
  } catch {
    return false;
  }
  if (LOGIN_HOST.test(url.hostname) || PORTAL_HOST.test(url.hostname) || LOGIN_PATH.test(url.pathname)) return true;

  const text = htmlToText(html);
  if (text.length > 4_000) return false;
  return /<input\b[^>]*type\s*=\s*["']?password/i.test(html) || LOGIN_PROMPT.test(text);
}

/** Block anything that isn't a public http(s) host — this fetches URLs a user typed. */
export function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ScrapeError("That doesn't look like a web address. Paste the full link, including https://");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScrapeError("Only http and https links can be read.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (!host.includes(".") && !host.includes(":")) ||
    (isIP(host) !== 0 && privateIp(host));
  if (isPrivate) throw new ScrapeError("That address isn't a public website.");
  return url;
}

/** Loopback, private, link-local, carrier-grade NAT, multicast and the like — anything not on the public internet. */
function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return privateIp(mapped);
    // ::ffff:7f00:1 is 127.0.0.1 written in hex.
    const hexMapped = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const [hi, lo] = [parseInt(hexMapped[1], 16), parseInt(hexMapped[2], 16)];
      return privateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return v6 === "::" || v6 === "::1" || /^(fc|fd|fe[89ab]|ff)/.test(v6);
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * The full check, for every address actually fetched — redirects and the
 * requests a rendered page makes included, not just the link the user pasted.
 * Looks the name up, so a public-looking hostname that points at a private
 * address is refused too.
 */
export async function assertPublic(url: URL): Promise<void> {
  validateUrl(url.toString());
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return; // A literal address was checked above.
  let addresses: string[];
  try {
    addresses = (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return; // Unresolvable: the fetch itself will fail and say so.
  }
  if (addresses.some(privateIp)) throw new ScrapeError("That address isn't a public website.");
}

/** Certificate faults: expired, issued for another name, missing a link in the chain, self-signed… */
const TLS_FAULT = /CERT|SSL|TLS|SIGNATURE|ISSUER|DH_KEY/;
/** Network blips worth one more try: the connection reset, refused, or DNS hiccuped. */
const TRANSIENT = /ECONNRESET|ECONNREFUSED|ECONNABORTED|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT/;

type FetchOptions = {
  /** Internal: this is already the retry of a network blip. */
  retried?: boolean;
  /** Sitemaps come back as application/xml, which a page fetch would refuse. */
  allowXml?: boolean;
  /** Sitemaps run long; pages that size are usually a mistake. */
  maxBytes?: number;
};

/** Second-level labels under which a domain is registered: ed.ac.uk, unimelb.edu.au. */
const SECOND_LEVEL = /^(ac|co|edu|gov|org|com|net|sch)$/;

/** "study.ed.ac.uk" and "www.ed.ac.uk" are one school; "ed.ac.uk" and "gla.ac.uk" are two. */
export function siteKey(host: string): string {
  const labels = host.toLowerCase().split(".");
  const keep = labels.length >= 3 && SECOND_LEVEL.test(labels.at(-2)!) && labels.at(-1)!.length === 2 ? 3 : 2;
  return labels.slice(-keep).join(".");
}

export function sameSite(a: URL, b: URL): boolean {
  return siteKey(a.hostname) === siteKey(b.hostname);
}

/** Visible text of a language switcher's English option, in the languages sites write it in. */
const ENGLISH_LABEL = /^(en|eng|english|englisch|anglais|inglés|ingles|inglese|engels|engelska|angielski)$/i;

/**
 * The address of this page in English, if the site has one and the page isn't
 * English already.
 *
 * The standard hreflang tag comes first: it names the matching page, so
 * Vienna's ".../astronomie-bachelorstudium" leads to
 * ".../astronomy-bachelors-programme". Failing that, a visible "EN" switcher
 * link (TUM's) — but not one that only goes to the English homepage from deep
 * in the site, which would trade the page the user asked about for a
 * front page.
 */
function englishAlternate(html: string, at: URL): string | null {
  const lang = html.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!lang || /^en\b/i.test(lang)) return null;

  const resolve = (href: string | undefined) => {
    if (!href) return null;
    try {
      const url = new URL(href.replace(/&amp;/g, "&"), at);
      url.hash = "";
      return /^https?:$/.test(url.protocol) && sameSite(url, at) && url.toString() !== at.toString() ? url : null;
    } catch {
      return null;
    }
  };

  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel\s*=\s*["']alternate["']/i.test(tag) || !/hreflang\s*=\s*["']en(-[a-z]+)?["']/i.test(tag)) continue;
    const url = resolve(tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]);
    if (url) return url.toString();
  }

  const depth = at.pathname.split("/").filter(Boolean).length;
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const [, attrs, inner] = m;
    const labelled =
      /hreflang\s*=\s*["']en(-[a-z]+)?["']/i.test(attrs) || ENGLISH_LABEL.test(htmlToText(inner).replace(/\s+/g, " ").trim());
    if (!labelled) continue;
    const url = resolve(attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]);
    if (!url) continue;
    const homepageOnly = url.pathname.split("/").filter(Boolean).length <= 1;
    if (homepageOnly && depth > 1) continue;
    return url.toString();
  }
  return null;
}

/**
 * Fetch a page, and swap in its English version when the site offers one.
 *
 * Reading the English page beats having the model translate: programme names
 * come out as the school's own English titles, nothing is lost in
 * translation, and English is cheaper in tokens than most languages. Kept only
 * if it's a real translation — some sites' English pages are a paragraph and
 * a link back to the original.
 */
export async function fetchPreferEnglish(
  url: string,
  options: FetchOptions = {},
  onProgress?: (message: string) => void,
): Promise<{ html: string; url: string }> {
  const page = await fetchPage(url, options);
  const alternate = englishAlternate(page.html, new URL(page.url));
  if (!alternate) return page;
  try {
    const english = await fetchPage(alternate, options);
    if (htmlToText(english.html).length < htmlToText(page.html).length * 0.4) return page;
    onProgress?.("Switching to the English version of the site");
    return english;
  } catch {
    return page;
  }
}

export async function getHtml(url: string, options: FetchOptions = {}): Promise<string> {
  return (await fetchPage(url, options)).html;
}

/** Hosts that refused a plain fetch but let the browser in: their pages go straight to the browser. */
const browserOnly = new Set<string>();

/**
 * A page and the address it finally came from. They differ more often than
 * you'd think — www.ed.ac.uk/studying/undergraduate/degrees is really
 * study.ed.ac.uk/programmes — and its relative links only resolve against the
 * second.
 *
 * Some sites refuse anything that isn't a browser — utoronto.ca returns 403 to
 * every plain fetch. Those get one more try in a real (headless) browser, which
 * loads them like any visitor's would. A site that refuses the browser too — a
 * Cloudflare "Just a moment…" check — stays refused.
 */
export async function fetchPage(url: string, options: FetchOptions = {}): Promise<{ html: string; url: string }> {
  const host = new URL(url).hostname;
  if (!options.allowXml && browserOnly.has(host)) {
    const page = await viaBrowser(url);
    if (!page) throw new AccessError("blocked", url);
    return page;
  }
  try {
    return await fetchDirect(url, options);
  } catch (err) {
    if (!(err instanceof AccessError) || err.kind !== "blocked" || options.allowXml) throw err;
    const page = await viaBrowser(url);
    if (!page) throw err;
    // Kept small on a long-running server: forgetting a host only costs one refused fetch.
    if (browserOnly.size >= 500) browserOnly.clear();
    browserOnly.add(host);
    return page;
  }
}

async function viaBrowser(url: string): Promise<{ html: string; url: string } | null> {
  // Loaded on demand: most fetches never need it, and it pulls in playwright.
  const { renderPage } = await import("./render");
  const page = await renderPage(url);
  if (page && isLoginWall(page.html, page.url)) throw new AccessError("login", page.url);
  return page;
}

async function fetchDirect(url: string, options: FetchOptions = {}, uaIndex = 0): Promise<{ html: string; url: string }> {
  const { allowXml = false, maxBytes = MAX_BYTES } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Redirects are followed by hand, one hop at a time, so each address is
    // checked before it's fetched — a public page can redirect to an internal one.
    let landed = url;
    let res: Response;
    for (let hop = 0; ; hop++) {
      await assertPublic(new URL(landed));
      res = await fetch(landed, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "user-agent": UA_LADDER[uaIndex],
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-GB,en;q=0.9",
        },
      });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) break;
      if (hop >= MAX_REDIRECTS) throw new ScrapeError("That link redirects too many times.");
      landed = new URL(location, landed).toString();
    }

    // A refusal is often about who we said we were, not the page itself.
    if ((res.status === 403 || res.status === 401) && uaIndex + 1 < UA_LADDER.length) {
      clearTimeout(timer);
      return fetchDirect(url, options, uaIndex + 1);
    }

    if (res.status === 401) throw new AccessError("login", landed);
    if (res.status === 403 || (res.status === 503 && res.headers.get("server")?.includes("cloudflare"))) {
      throw new AccessError("blocked", landed);
    }
    if (!res.ok) throw new ScrapeError(`The site returned ${res.status} for that page.`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text") && !(allowXml && type.includes("xml"))) {
      throw new ScrapeError("That link isn't a web page — it may be a PDF or a file download.");
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new ScrapeError("That page is too large to read.");
    const html = new TextDecoder("utf-8").decode(buf);
    if (!allowXml && isLoginWall(html, landed)) throw new AccessError("login", landed);
    return { html, url: landed };
  } catch (err) {
    if (err instanceof ScrapeError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ScrapeError("The site took too long to respond.");
    }
    const code = (err as { cause?: { code?: string } })?.cause?.code ?? "";

    // About one university site in twelve has a broken certificate. We refuse
    // them outright — no reading past the fault, and no falling back to plain
    // http, which has no protection at all: a tampered page could carry a
    // wrong deadline, and the brief would repeat it with confidence. (Owner's
    // decision, after a 1,000-university test showed it costs ~5% of sites.)
    if (TLS_FAULT.test(code)) {
      throw new ScrapeError(
        "That site's security certificate is broken — expired, or set up for a different address — so the app won't read it. Your browser will probably warn about it too.",
      );
    }

    if (TRANSIENT.test(code) && !options.retried) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      return fetchDirect(url, { ...options, retried: true }, uaIndex);
    }
    throw new ScrapeError("Couldn't reach that page. Check the link and try again.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTML to readable text. Not a full parser — a deliberate flattening that
 * keeps the structure the model needs (headings, list items, table cells,
 * link text) and drops everything it doesn't.
 */
/**
 * Drop site chrome. University mega-menus list every section of the site on
 * every page — left in, they crowd out the actual content and give the link
 * ranker hundreds of plausible-looking but irrelevant targets.
 */
export function stripChrome(html: string): string {
  return html
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<[a-z]+\b[^>]*role\s*=\s*["']navigation["'][^>]*>[\s\S]*?<\/[a-z]+>/gi, " ");
}

/**
 * Drop the site footer's link farm. Only the big ones: course cards often use
 * a small <footer> of their own to hold the card's link, and taking those out
 * takes out the very links we came for.
 */
export function stripFooter(html: string): string {
  return html.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, (block) => (block.length > 1_500 ? " " : block));
}

/** Link text worth keeping the address of: the places a brief sends people. */
const REFERENCE_TEXT =
  /fee|tuition|cost|financ|fund|scholar|bursar|award|grant|apply|application|portal|admission|requirement|deadline|dates|english|language|test|exam|housing|residence|accommodat|visa|immigra|contact|enquir|inquir|international|document|transcript|guide|calendar|ouac|ucas|common app|handbook|zulassung|bewerbung|anmeldung|frist|termin|gebühr|beitrag|kosten|stipendi|voraussetzung|aufnahme|sprach|wohn|kontakt|frais|bourse|inscription/i;
/**
 * Addresses per page. Each costs ~70 characters of a budget that can be 16k
 * in total — and more in tokens than the characters suggest, since URLs
 * tokenize far worse than prose.
 */
const MAX_INLINE_LINKS = 12;

/**
 * Write the address of useful links into the page, as "text (link: URL)".
 *
 * Flattening HTML to text throws hrefs away, and then the brief can only say
 * "see the tuition page on the Finance website" without being able to point
 * at it. Only links from the page's own content qualify — menus and footers
 * would spend the whole allowance on "Accessibility" and "Careers" — and only
 * the first mention of each address.
 */
export function withLinks(html: string, base: URL): string {
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const resolve = (attrs: string): string | null => {
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) return null;
    try {
      const url = new URL(href.replace(/&amp;/g, "&"), base);
      if (!/^https?:$/.test(url.protocol)) return null;
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  };

  const eligible = new Set<string>();
  for (const m of stripFooter(stripChrome(html)).matchAll(anchor)) {
    if (eligible.size >= MAX_INLINE_LINKS) break;
    const url = resolve(m[1]);
    const text = htmlToText(m[2]).replace(/\s+/g, " ").trim();
    if (!url || text.length < 3 || text.length > 100) continue;
    const offsitePortal = new URL(url).hostname !== base.hostname && /apply|portal|application/i.test(url);
    if (REFERENCE_TEXT.test(text) || offsitePortal) eligible.add(url);
  }

  const written = new Set<string>();
  return html.replace(anchor, (whole, attrs: string) => {
    const url = resolve(attrs);
    if (!url || !eligible.has(url) || written.has(url)) return whole;
    written.add(url);
    return `${whole} (link: ${url}) `;
  });
}

/** The page's own content, when it marks it — where the real links live. */
function mainRegion(html: string): string {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main && main[1].length > 500) return main[1];
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (article && article[1].length > 500) return article[1];
  // No landmark — fall back to the body minus the footer link farm.
  return stripFooter(html);
}

export function htmlToText(html: string): string {
  let out = stripChrome(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|form|select)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(h[1-6]|p|div|section|article|tr|li|dd|dt|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<h[1-6]\b[^>]*>/gi, "\n\n## ")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");

  out = out
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, " ");

  return out
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((line, i, arr) => line.length > 0 || arr[i - 1]?.length !== 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Fit a page into a character budget by keeping the parts that carry
 * admissions information, not the first N characters.
 *
 * This matters most on a free tier, where the budget is small: the opening of
 * a course page is nearly always prose about the subject, while the deadlines,
 * grades and fees sit further down. Taking the top of the page produces a
 * brief that is honest and empty; taking the relevant sections produces a
 * useful one from the same number of tokens.
 */
export function condense(text: string, limit: number): string {
  if (text.length <= limit) return text;

  // Blocks are headed sections where the page has headings, paragraphs
  // otherwise. Either way they're units worth keeping or dropping whole.
  const raw = text.split(/\n(?=## )|\n{2,}/).filter((b) => b.trim().length > 0);

  // Fact tables (<dt>/<dd>, two-column rows) come out as a short label block
  // followed by its value: "Tuition fees per semester" / "None". Scored apart,
  // the label looks relevant and the value doesn't, so the answer gets dropped
  // and the question kept. Glue each short label to what follows it.
  const blocks: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const block = raw[i].trim();
    const isLabel = block.length <= 80 && !/[.!?]$/.test(block) && !block.startsWith("## ");
    if (isLabel && i + 1 < raw.length) {
      blocks.push(`${block}\n${raw[i + 1].trim()}`);
      i++;
    } else {
      blocks.push(block);
    }
  }

  const base = blocks.map((block, index) => {
    let score = 0;
    for (const signal of ADMISSIONS_SIGNALS) if (signal.test(block)) score += 3;
    // Concrete facts are what we're short of: dates, money, grades, scores.
    if (/\b(19|20)\d{2}\b/.test(block)) score += 2;
    if (/\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i.test(block)) score += 4;
    if (/[£$€]\s?[\d,]+|\b\d[\d,.]*\s?(EUR|euros?|GBP|USD)\b/i.test(block)) score += 4;
    if (/\b[A-D]\*?[A-D]\*?[A-D]\*?\b|\bIELTS\b|\bTOEFL\b|\bGPA\b|\bUCAS\b|\b[ABC][12]\b/.test(block)) score += 3;
    if (/\b\d{1,3}\s*(points|credits|ECTS|%)\b/i.test(block)) score += 2;
    // The opening block names the course and school; always worth its space.
    if (index === 0) score += 100;
    return score;
  });

  // A block next to a relevant one is usually its continuation — the rest of
  // a requirements list, the second half of a fees table — so it borrows some
  // of its neighbours' relevance.
  const scored = blocks.map((block, index) => ({
    block,
    index,
    score: base[index] + 0.5 * ((base[index - 1] ?? 0) + (base[index + 1] ?? 0)),
  }));

  const kept = new Set<number>();
  let used = 0;
  const take = (entry: (typeof scored)[number]) => {
    if (kept.has(entry.index) || used + entry.block.length + 2 > limit) return;
    kept.add(entry.index);
    used += entry.block.length + 2;
  };

  // Rank by relevance per character, not raw relevance. A course page's key
  // facts panel — "UCAS code / G402", "Duration / 3 years" — is the densest
  // information on it, and a raw score lets one long paragraph that happens
  // to mention a few keywords outbid a dozen of those. The +40 damps the
  // effect so that three-character menu crumbs don't win on density alone.
  const density = (e: (typeof scored)[number]) => e.score / Math.sqrt(e.block.length + 40);

  // Most relevant first, then whatever's left in reading order. Nothing is
  // dropped while there's still budget for it — the budget is what we can
  // afford to send, not a target to come in under.
  for (const entry of [...scored].sort((a, b) => density(b) - density(a))) if (entry.score > 0) take(entry);
  for (const entry of scored) take(entry);

  // A page whose first block alone overflows still deserves its opening.
  if (kept.size === 0) return text.slice(0, limit);

  const ordered = scored.filter((e) => kept.has(e.index));
  const gaps = ordered.length < scored.length;
  return ordered.map((e) => e.block).join("\n\n") + (gaps ? "\n\n[Less relevant sections of this page were omitted.]" : "");
}

export function pageTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1]).slice(0, 200) : null;
}

/**
 * Same-site links whose anchor text suggests application information.
 *
 * Only looks inside the page's own content, and prefers links that stay in the
 * same part of the site — an undergraduate course page should follow
 * undergraduate fees, not the postgraduate ones the global menu also offers.
 */
function rankLinks(html: string, base: URL): string[] {
  const baseSegment = base.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  const scores = new Map<string, number>();

  function collect(scope: string, bonus: number) {
    const anchor = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;

    while ((m = anchor.exec(scope)) !== null) {
      const [, href, inner] = m;
      if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue;

      let target: URL;
      try {
        target = new URL(href, base);
      } catch {
        continue;
      }
      if (target.hostname !== base.hostname) continue;
      if (/\.(pdf|docx?|xlsx?|zip|jpe?g|png|gif|mp4)$/i.test(target.pathname)) continue;

      target.hash = "";
      const key = target.toString();
      if (key === base.toString()) continue;

      const text = htmlToText(inner).slice(0, 120);
      let score = LINK_HINTS.reduce((acc, [re, pts]) => (re.test(text) ? acc + pts : acc), 0);
      if (score === 0) continue;
      score += bonus;

      // Staying in the same branch of the site is a strong signal that the
      // page is about the same course and level as the one we started from.
      const targetSegment = target.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
      if (baseSegment && targetSegment === baseSegment) score += 5;

      scores.set(key, Math.max(scores.get(key) ?? 0, score));
    }
  }

  const chromeless = stripChrome(html);

  // Links the page itself put in its content beat links the template shows on
  // every page — but a hub page like /apply/ keeps its real links in the menu,
  // so fall back to the rest of the document when content alone comes up short.
  collect(mainRegion(chromeless), 3);
  if (scores.size < PAGE_BUDGET) {
    collect(stripFooter(html), 0);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, PAGE_BUDGET)
    .map(([url]) => url);
}

const CURRENCY = String.raw`(?:[£$€₹¥]|\b(?:CAD|USD|AUD|NZD|EUR|GBP|CHF|SGD|HKD)\b)`;

/** Text that answers "how much does it cost to apply?" — with an amount, or with "nothing". */
const FEE_STATED = new RegExp(
  [
    String.raw`application fee[^\n]{0,120}?${CURRENCY}\s?\d`,
    String.raw`${CURRENCY}\s?\d[\d,.]*[^\n]{0,80}application fee`,
    String.raw`no application fee|application fee[^\n]{0,40}\b(waived|free|none)\b|free to apply`,
  ].join("|"),
  "i",
);

/** Same-site links likely to state the application fee, best first. */
function feeLinks(html: string, base: URL, exclude: Set<string>): string[] {
  const scores = new Map<string, number>();
  const anchor = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(html)) !== null) {
    let target: URL;
    try {
      target = new URL(m[1].replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    target.hash = "";
    if (target.hostname !== base.hostname || exclude.has(target.toString())) continue;
    if (/\.(pdf|docx?|xlsx?|zip|jpe?g|png|gif|mp4)$/i.test(target.pathname)) continue;

    const text = htmlToText(m[2]).slice(0, 120);
    let score = 0;
    if (/application fee|bewerbungsgebühr|kostenbeitrag|frais de dossier/i.test(text)) score = 10;
    else if (/\bfees?\b/i.test(text) && !/tuition/i.test(text)) score = 6;
    else if (/how to apply|application process|applying/i.test(text)) score = 5;
    else if (/tuition|cost/i.test(text)) score = 2;
    if (score > 0) scores.set(target.toString(), Math.max(scores.get(target.toString()) ?? 0, score));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

/** The lines of a page about the application fee, with a line either side for context. */
function feeLines(text: string): string {
  const lines = text.split("\n");
  const keep = new Set<number>();
  const amount = new RegExp(`${CURRENCY}\\s?\\d`, "i");
  lines.forEach((line, i) => {
    const near = `${line} ${lines[i + 1] ?? ""}`;
    if (/application fee|fee to apply|apply.{0,40}\bfee\b|bewerbungsgebühr|kostenbeitrag|frais de dossier/i.test(line) && (amount.test(near) || FEE_STATED.test(near))) {
      for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j++) keep.add(j);
    }
  });
  return [...keep]
    .sort((a, b) => a - b)
    .map((i) => lines[i])
    .join("\n")
    .slice(0, 1_500);
}

export type Corpus = {
  text: string;
  pagesRead: string[];
  truncated: boolean;
};

export type GatherOptions = {
  /** Total budget across all pages. Small local models need a much smaller one. */
  maxChars?: number;
  /** How many linked pages to follow beyond the one the user pasted. */
  maxPages?: number;
  onProgress?: (message: string) => void;
};

/**
 * Divide a character budget between pages without wasting any of it.
 *
 * Each page gets a share in proportion to its weight; a page shorter than its
 * share is sent whole and the surplus goes back to the others. So a lone page
 * gets the entire budget, and a short fees page doesn't strand space that a
 * long course page could have used.
 */
function allocate(lengths: number[], weights: number[], budget: number): number[] {
  const caps = new Array<number>(lengths.length).fill(0);
  const open = new Set(lengths.map((_, i) => i));
  let remaining = budget;

  while (open.size > 0) {
    const totalWeight = [...open].reduce((sum, i) => sum + weights[i], 0);
    const settled = [...open].filter((i) => lengths[i] <= (remaining * weights[i]) / totalWeight);
    if (settled.length === 0) {
      for (const i of open) caps[i] = Math.floor((remaining * weights[i]) / totalWeight);
      break;
    }
    for (const i of settled) {
      caps[i] = lengths[i];
      remaining -= lengths[i];
      open.delete(i);
    }
  }
  return caps;
}

/**
 * Read the given page plus the most promising linked pages.
 * `onProgress` reports each page as it lands so the UI isn't silent.
 */
export async function gatherPages(startUrl: string, options: GatherOptions = {}): Promise<Corpus> {
  const { maxChars = DEFAULT_MAX_CHARS, maxPages = PAGE_BUDGET, onProgress } = options;

  const base = validateUrl(startUrl);
  onProgress?.(`Reading ${base.hostname}`);

  const root = await fetchPreferEnglish(base.toString(), {}, onProgress);
  const rootHtml = root.html;
  // Links resolve against where the page actually lives, after redirects.
  const landed = new URL(root.url);
  const rootText = htmlToText(withLinks(rootHtml, landed));

  // Course finders and portals often render everything client-side, so a plain
  // fetch gets an empty frame. A thin page with none of the admissions
  // vocabulary on it is that. Say so plainly rather than handing the model a
  // blank page and letting it fill the silence.
  const signals = ADMISSIONS_SIGNALS.filter((re) => re.test(rootText)).length;
  if (rootText.length < THIN_PAGE_CHARS && signals < 2) {
    throw new ScrapeError(
      "There was almost nothing on that page to read — it probably loads its content with JavaScript, or it's a search page rather than a course page. Try the link that shows the course details themselves.",
    );
  }

  const pages = [{ url: root.url, title: pageTitle(rootHtml), text: rootText }];

  const followUps = rankLinks(rootHtml, landed).slice(0, maxPages);
  if (followUps.length > 0) {
    onProgress?.(`Following ${followUps.length} linked page${followUps.length > 1 ? "s" : ""}`);
  }

  const htmls = [{ html: rootHtml, base: landed }];
  const results = await Promise.allSettled(followUps.map((u) => fetchPreferEnglish(u)));
  results.forEach((result) => {
    if (result.status !== "fulfilled") return;
    const at = new URL(result.value.url);
    htmls.push({ html: result.value.html, base: at });
    const text = htmlToText(withLinks(result.value.html, at));
    if (text.length < 200) return; // a shell page with nothing on it
    pages.push({ url: result.value.url, title: pageTitle(result.value.html), text });
  });

  // The application fee is the one figure people most often have to go
  // hunting for, and it's rarely on the course page — it's on a "how to
  // apply" or fees page the link ranker didn't have room for. If nothing read
  // so far states it, open up to two likely pages and keep only their lines
  // about the fee: a few hundred characters, not two more whole pages.
  if (!pages.some((p) => FEE_STATED.test(p.text))) {
    const read = new Set([base.toString(), landed.toString(), ...followUps]);
    const candidates = [...new Set(htmls.flatMap(({ html, base: at }) => feeLinks(html, at, read)))].slice(0, 2);
    if (candidates.length > 0) {
      onProgress?.("Looking for the application fee");
      const feePages = await Promise.allSettled(candidates.map((u) => fetchPreferEnglish(u)));
      feePages.forEach((result) => {
        if (result.status !== "fulfilled") return;
        const lines = feeLines(htmlToText(withLinks(result.value.html, new URL(result.value.url))));
        if (lines) pages.push({ url: result.value.url, title: "Application fee details (excerpt)", text: lines });
      });
    }
  }

  // Budget is divided only now, once we know which pages actually arrived —
  // the page the user asked about counts double, and nothing is reserved for
  // pages that never turned up.
  // Headers and the omission note count against the budget too — on a free
  // tier the budget is a hard ceiling, not a guideline.
  const headers = pages.map((p, i) => `=== PAGE ${i + 1}: ${p.url} ===\nTitle: ${p.title ?? "(none)"}\n\n`);
  const overhead = headers.reduce((sum, h) => sum + h.length + 2, 0) + pages.length * 60;

  const caps = allocate(
    pages.map((p) => p.text.length),
    pages.map((_, i) => (i === 0 ? 2 : 1)),
    Math.max(2_000, maxChars - overhead),
  );

  let truncated = false;
  const sections = pages.map((page, i) => {
    const fits = page.text.length <= caps[i];
    truncated ||= !fits;
    return headers[i] + (fits ? page.text : condense(page.text, caps[i]));
  });

  return { text: sections.join("\n\n"), pagesRead: pages.map((p) => p.url), truncated };
}
