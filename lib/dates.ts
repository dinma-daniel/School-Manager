import type { Deadline, Intake, SchoolInfo } from "./schema";

const DAY = 86_400_000;

export type DatedDeadline = Deadline & { daysAway: number | null };

/** A deadline we could actually place on the calendar. */
export type UpcomingDeadline = Deadline & { daysAway: number };

function daysFromNow(iso: string | null): number | null {
  if (!iso) return null;
  const time = Date.parse(`${iso}T00:00:00`);
  if (Number.isNaN(time)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((time - today.getTime()) / DAY);
}

export function withDays(deadlines: Deadline[]): DatedDeadline[] {
  return deadlines.map((d) => ({ ...d, daysAway: daysFromNow(d.iso) }));
}

/** The soonest deadline still ahead of us — what the planner sorts and leads on. */
export function nextDeadline(info: SchoolInfo): UpcomingDeadline | null {
  const upcoming = withDays(info.deadlines)
    .filter((d): d is UpcomingDeadline => d.daysAway !== null && d.daysAway >= 0)
    .sort((a, b) => a.daysAway - b.daysAway);
  return upcoming[0] ?? null;
}

export function countdown(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 31) return `${days} days`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const years = (days / 365).toFixed(1).replace(/\.0$/, "");
  return `${years} years`;
}

/** Schools saved before start dates were read have no `intakes` at all. */
export function intakesOf(info: SchoolInfo): Intake[] {
  return info.intakes ?? [];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAME =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b/i;
/** The month each season's intake usually starts, as sites name them. */
const SEASONS: [RegExp, number][] = [
  [/\b(autumn|fall)\b/i, 9],
  [/\b(winter|spring)\b/i, 1],
  [/\bsummer\b/i, 5],
];

/** A start month to group by: "2027-09" shown as "Sep 2027". */
export type StartMonth = { key: string; label: string };

/**
 * The month an intake begins. Pages rarely give a day ("September 2027",
 * "Fall 2027"), so this reads the month and year from the words when there's
 * no exact date. A month with no year gets its own bucket after the dated ones.
 */
export function startMonth(intake: Intake): StartMonth | null {
  let month: number | null = null;
  let year: number | null = null;

  if (intake.iso) {
    year = Number(intake.iso.slice(0, 4));
    month = Number(intake.iso.slice(5, 7));
  } else {
    // Months only from the date itself — a label like "Places may be limited"
    // would otherwise read as May. Seasons can come from either.
    const named = intake.date.match(MONTH_NAME);
    if (named) month = MONTHS.findIndex((m) => m.toLowerCase() === named[1].slice(0, 3).toLowerCase()) + 1;
    else month = SEASONS.find(([re]) => re.test(`${intake.date} ${intake.label}`))?.[1] ?? null;
    const y = intake.date.match(/\b(20\d{2})\b/);
    if (y) year = Number(y[1]);
  }

  if (!month) return null;
  const mm = String(month).padStart(2, "0");
  return year
    ? { key: `${year}-${mm}`, label: `${MONTHS[month - 1]} ${year}` }
    : { key: `9999-${mm}`, label: `${MONTHS[month - 1]} (year not given)` };
}

/** Sort key: schools with a live deadline first, soonest at the top. */
export function urgency(info: SchoolInfo): number {
  const next = nextDeadline(info);
  return next?.daysAway ?? Number.MAX_SAFE_INTEGER;
}
