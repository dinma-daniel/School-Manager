/**
 * Narrowing the saved list. Pure, so the planner and the compare grid share
 * one answer to "which schools are showing".
 */

import { intakesOf, startMonth } from "./dates";
import { convert, readTuition, type Rates } from "./money";
import type { SavedSchool } from "./schema";

export type Filters = {
  query: string;
  scholarships: boolean;
  stage: SavedSchool["status"] | null;
  level: string | null;
  /** A start month key, "2027-09". */
  starts: string | null;
  fee: {
    /** As typed, so a half-written number isn't snapped back. */
    min: string;
    max: string;
    /** Empty until picked: the planner then uses the currency most of the list is priced in. */
    currency: string;
  };
  /** Keep schools whose tuition can't be placed in the range. */
  includeUnknownFee: boolean;
};

export const NO_FILTERS: Filters = {
  query: "",
  scholarships: false,
  stage: null,
  level: null,
  starts: null,
  fee: { min: "", max: "", currency: "" },
  includeUnknownFee: false,
};

const amount = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ""));
  return s.trim() && Number.isFinite(n) ? n : null;
};

export function feeRange(f: Filters): { min: number | null; max: number | null } {
  return { min: amount(f.fee.min), max: amount(f.fee.max) };
}

/** How many filters are narrowing the list — the search box counts on its own. */
export function activeCount(f: Filters): number {
  const { min, max } = feeRange(f);
  return [f.scholarships, f.stage, f.level, f.starts, min !== null || max !== null].filter(Boolean).length;
}

export function levelKey(level: string | null): string | null {
  return level?.trim().toLowerCase() || null;
}

/** Where a school's tuition falls against the range, or "unknown" if it can't be placed. */
function feeVerdict(school: SavedSchool, f: Filters, rates: Rates | null): "in" | "out" | "unknown" {
  const { min, max } = feeRange(f);
  if (min === null && max === null) return "in";
  const tuition = readTuition(school.info);
  if (!tuition) return "unknown";
  const value = convert(tuition, f.fee.currency, rates);
  if (value === null) return "unknown";
  if (min !== null && value < min) return "out";
  if (max !== null && value > max) return "out";
  return "in";
}

function matchesQuery(school: SavedSchool, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const { name, programme, location, level } = school.info;
  return [name, programme, location, level, school.note].some((field) => field?.toLowerCase().includes(q));
}

export type FilterResult = {
  shown: SavedSchool[];
  /** Hidden only because their tuition couldn't be read or converted. */
  unknownFee: number;
};

export function applyFilters(schools: SavedSchool[], f: Filters, rates: Rates | null): FilterResult {
  let unknownFee = 0;
  const shown = schools.filter((s) => {
    if (!matchesQuery(s, f.query)) return false;
    if (f.scholarships && s.info.scholarships.length === 0) return false;
    if (f.stage && s.status !== f.stage) return false;
    if (f.level && levelKey(s.info.level) !== f.level) return false;
    if (f.starts && !intakesOf(s.info).some((i) => startMonth(i)?.key === f.starts)) return false;

    const fee = feeVerdict(s, f, rates);
    if (fee === "out") return false;
    if (fee === "unknown" && !f.includeUnknownFee) {
      unknownFee++;
      return false;
    }
    return true;
  });
  return { shown, unknownFee };
}

/** A choice to offer, with how many saved schools it would keep. */
export type Option<T> = { value: T; label: string; count: number };

function tally<T>(entries: { value: T; label: string }[]): Option<T>[] {
  const counts = new Map<T, Option<T>>();
  for (const e of entries) {
    const prev = counts.get(e.value);
    counts.set(e.value, { ...e, count: (prev?.count ?? 0) + 1 });
  }
  return [...counts.values()];
}

/** The options worth offering, drawn from what's actually saved. */
export function facets(schools: SavedSchool[]) {
  const levels = tally(
    schools.flatMap((s) => {
      const key = levelKey(s.info.level);
      return key ? [{ value: key, label: s.info.level!.trim() }] : [];
    }),
  ).sort((a, b) => b.count - a.count);

  // One count per school, even when a school lists two intakes in one month.
  const starts = tally(
    schools.flatMap((s) => {
      const months = new Map<string, string>();
      for (const i of intakesOf(s.info)) {
        const m = startMonth(i);
        if (m) months.set(m.key, m.label);
      }
      return [...months].map(([value, label]) => ({ value, label }));
    }),
  ).sort((a, b) => a.value.localeCompare(b.value));

  const stages = tally(schools.map((s) => ({ value: s.status, label: s.status })));
  const withScholarships = schools.filter((s) => s.info.scholarships.length > 0).length;

  // Currencies the saved fees are in, most common first, so the range starts
  // in the one most of the list is priced in.
  const currencies = tally(
    schools.flatMap((s) => {
      const c = readTuition(s.info)?.currency;
      return c ? [{ value: c, label: c }] : [];
    }),
  ).sort((a, b) => b.count - a.count);

  return { levels, starts, stages, withScholarships, currencies };
}
