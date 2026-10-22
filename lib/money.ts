/**
 * Reading tuition figures well enough to filter on.
 *
 * Fees arrive as the page wrote them — "£9,535 per year (UK) · £30,940 per
 * year (international)", "$11,752 (in-state) · $42,778 (out-of-state)",
 * "CAD 45,000" — so a range filter needs one number per school. This picks
 * the figure an international applicant would pay, or the highest one when
 * the page doesn't say who pays what, so a budget filter never shows a school
 * as cheaper than it is. Anything it can't read stays unknown rather than
 * guessed.
 */

import type { SchoolInfo } from "./schema";

const CODES = "USD|CAD|AUD|NZD|GBP|EUR|CHF|NGN|GHS|KES|ZAR|INR|SGD|HKD|JPY|CNY|SEK|NOK|DKK|AED|MYR";

const SYMBOLS: Record<string, string> = {
  "US$": "USD",
  "CA$": "CAD",
  C$: "CAD",
  AU$: "AUD",
  A$: "AUD",
  NZ$: "NZD",
  S$: "SGD",
  HK$: "HKD",
  "£": "GBP",
  "€": "EUR",
  "₦": "NGN",
  "₹": "INR",
};

const NUMBER = String.raw`(\d[\d,.]*\d|\d)(\s?(?:k|thousand|million|m)\b)?`;
const MONEY = new RegExp(
  String.raw`(?:\b(${CODES})\s?|(US\$|CA\$|C\$|AU\$|A\$|NZ\$|S\$|HK\$|[£€₦₹$])\s?)${NUMBER}|(\d[\d,.]*\d|\d)\s?(${CODES})\b`,
  "gi",
);

/** Who the figure is for, where the page labels it. */
const INTERNATIONAL = /international|overseas|non-?resident|out[- ]of[- ]state|non-?eu|foreign|non-?canadian|non-?citizen/i;
/** Figures that aren't a year's tuition and can't be made into one. */
const NOT_ANNUAL = /^\W{0,3}(per|a|each|\/)\s?(credit|unit|hour|course|module|subject|point)/i;
const PER_SEMESTER = /^\W{0,3}(per|a|each|\/)\s?semester/i;

export type Tuition = {
  /** Per year, in `currency`. */
  value: number;
  /** Null only for free tuition, which is zero in every currency. */
  currency: string | null;
  /** How the figure was chosen, for saying so in the UI. */
  basis: "free" | "only" | "international" | "highest";
};

/** "$" means dollars of wherever the school is. */
function dollarsOf(location: string | null): string {
  if (/canada/i.test(location ?? "")) return "CAD";
  if (/australia/i.test(location ?? "")) return "AUD";
  if (/new zealand/i.test(location ?? "")) return "NZD";
  if (/singapore/i.test(location ?? "")) return "SGD";
  if (/hong kong/i.test(location ?? "")) return "HKD";
  return "USD";
}

function toNumber(raw: string, scale: string | undefined): number | null {
  let s = raw;
  // "1.234,56" and "45.000" are European thousands, not decimals.
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  const unit = scale?.trim().toLowerCase();
  if (unit === "k" || unit === "thousand") n *= 1_000;
  if (unit === "m" || unit === "million") n *= 1_000_000;
  return n;
}

/** One school's yearly tuition as a number, or null when the page doesn't give one we can use. */
export function readTuition(info: SchoolInfo): Tuition | null {
  const text = info.costs.tuition;
  if (!text) return null;
  if (/^none\b|no tuition|tuition[- ]free|free of charge|no charge/i.test(text)) return { value: 0, currency: null, basis: "free" };

  // Clauses, so a label sits with its own figure: "(UK) · £30,940 (international)".
  const clauses = text.split(/\s*[·;|\n]\s*|,\s+(?=\D)|\s+\/\s+/);
  const found: { value: number; currency: string; international: boolean }[] = [];

  for (const clause of clauses) {
    const international = INTERNATIONAL.test(clause);
    for (const m of clause.matchAll(MONEY)) {
      const [whole, code, symbol, num, scale, numAfter, codeAfter] = m;
      const after = clause.slice((m.index ?? 0) + whole.length);
      if (NOT_ANNUAL.test(after)) continue;

      const currency = (code ?? codeAfter)?.toUpperCase() ?? (symbol === "$" ? dollarsOf(info.location) : SYMBOLS[symbol]);
      let value = toNumber(num ?? numAfter, scale);
      if (!currency || value === null || value <= 0) continue;
      if (PER_SEMESTER.test(after)) value *= 2;
      found.push({ value, currency, international });
    }
  }

  if (found.length === 0) return null;
  const intl = found.filter((f) => f.international);
  const pool = intl.length > 0 ? intl : found;
  const top = pool.reduce((a, b) => (b.value > a.value ? b : a));
  return {
    value: top.value,
    currency: top.currency,
    basis: found.length === 1 ? "only" : intl.length > 0 ? "international" : "highest",
  };
}

/** Units of each currency per US dollar. */
export type Rates = Record<string, number>;

/** A tuition figure in another currency, or null when there's no rate for either side. */
export function convert(t: Tuition, to: string, rates: Rates | null): number | null {
  if (t.currency === null) return 0;
  if (t.currency === to) return t.value;
  const from = rates?.[t.currency];
  const into = rates?.[to];
  if (!from || !into) return null;
  return (t.value / from) * into;
}

export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}
