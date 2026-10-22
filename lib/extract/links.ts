import type { SchoolInfo } from "../schema";

const URL_IN_TEXT = /https?:\/\/[^\s)\]>"]+/g;

/** Trailing punctuation a sentence leaves on an address, and the trailing slash. */
const tidy = (url: string) => url.replace(/[.,;:!?'"]+$/, "");
const key = (url: string) => tidy(url).replace(/\/$/, "").toLowerCase();

/**
 * Drop every address in the brief's prose that the pages didn't contain.
 *
 * The model is told to copy addresses, not compose them, but a plausible-
 * looking "https://uni.edu/admissions/fees" is exactly the kind of thing a
 * model writes from memory — and a link that 404s, or lands on the wrong
 * year's fees, is worse than none. So anything not seen in the corpus goes.
 *
 * Only free text is checked. The dedicated URL fields (applyUrl, contactUrl,
 * a scholarship's url) have always been allowed to come from a domain the
 * page names in words, and stay as they are.
 */
export function keepKnownLinks(info: SchoolInfo, corpusText: string, pagesRead: string[]): SchoolInfo {
  const known = new Set([...(corpusText.match(URL_IN_TEXT) ?? []), ...pagesRead].map(key));

  const clean = (text: string): string =>
    text
      .replace(/\s*\(\s*(https?:\/\/[^\s)]+)\s*\)/g, (whole, url: string) => (known.has(key(url)) ? ` (${tidy(url)})` : ""))
      .replace(URL_IN_TEXT, (url) => (known.has(key(url)) ? url : ""))
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.,;])/g, "$1")
      .trim();
  const maybe = (text: string | null) => (text === null ? null : clean(text));

  return {
    ...info,
    summary: clean(info.summary),
    steps: info.steps.map((s) => ({ title: clean(s.title), detail: clean(s.detail) })),
    deadlines: info.deadlines.map((d) => ({ ...d, notes: maybe(d.notes) })),
    requirements: info.requirements.map((g) => ({ ...g, items: g.items.map(clean) })),
    costs: {
      applicationFee: maybe(info.costs.applicationFee),
      tuition: maybe(info.costs.tuition),
      living: maybe(info.costs.living),
      notes: maybe(info.costs.notes),
    },
    scholarships: info.scholarships.map((s) => ({ ...s, eligibility: maybe(s.eligibility), amount: maybe(s.amount) })),
    watchOuts: info.watchOuts.map(clean),
    notFound: info.notFound.map(clean),
  };
}
