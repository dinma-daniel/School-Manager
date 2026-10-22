import { intakesOf } from "./dates";
import type { SavedSchool } from "./schema";

const DAY = 86_400_000;

/** One date on the calendar: a deadline, or the day a course starts. */
export type CalendarEvent = {
  /** Stable across renders and exports, so a re-imported .ics updates rather than duplicates. */
  id: string;
  kind: "deadline" | "start";
  /** YYYY-MM-DD. */
  iso: string;
  /** Days from today; negative once it's passed. */
  daysAway: number;
  label: string;
  /** The date as the school's page wrote it. */
  stated: string;
  notes: string | null;
  schoolId: string;
  school: string;
  programme: string | null;
  sourceUrl: string;
};

/** A deadline the page gave no fixed day for — "Rolling admissions", "Mid-January". */
export type UndatedDeadline = {
  id: string;
  label: string;
  stated: string;
  notes: string | null;
  schoolId: string;
  school: string;
  programme: string | null;
};

function today(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

function daysAway(iso: string): number | null {
  const time = Date.parse(`${iso}T00:00:00`);
  return Number.isNaN(time) ? null : Math.round((time - today()) / DAY);
}

/** Every dated deadline and start date across the saved schools, soonest first. */
export function calendarEvents(schools: SavedSchool[]): { dated: CalendarEvent[]; undated: UndatedDeadline[] } {
  const dated: CalendarEvent[] = [];
  const undated: UndatedDeadline[] = [];

  for (const s of schools) {
    const common = { schoolId: s.id, school: s.info.name, programme: s.info.programme };

    s.info.deadlines.forEach((d, i) => {
      const away = d.iso ? daysAway(d.iso) : null;
      if (d.iso && away !== null) {
        dated.push({
          ...common,
          id: `${s.id}-d${i}`,
          kind: "deadline",
          iso: d.iso,
          daysAway: away,
          label: d.label,
          stated: d.date,
          notes: d.notes,
          sourceUrl: s.sourceUrl,
        });
      } else {
        undated.push({ ...common, id: `${s.id}-d${i}`, label: d.label, stated: d.date, notes: d.notes });
      }
    });

    // Start dates only when the page gave a day; "September 2027" has no square to sit in.
    intakesOf(s.info).forEach((intake, i) => {
      const away = intake.iso ? daysAway(intake.iso) : null;
      if (!intake.iso || away === null) return;
      dated.push({
        ...common,
        id: `${s.id}-s${i}`,
        kind: "start",
        iso: intake.iso,
        daysAway: away,
        label: intake.label || "Course starts",
        stated: intake.date,
        notes: null,
        sourceUrl: s.sourceUrl,
      });
    });
  }

  dated.sort((a, b) => a.iso.localeCompare(b.iso) || a.school.localeCompare(b.school));
  return { dated, undated };
}

/** How pressing a date is, for colouring it. */
export function urgencyOf(event: CalendarEvent): "past" | "now" | "soon" | "later" {
  if (event.daysAway < 0) return "past";
  if (event.daysAway <= 7) return "now";
  if (event.daysAway <= 30) return "soon";
  return "later";
}

/* -------------------------------------------------------------------------- */
/* .ics export                                                                */
/* -------------------------------------------------------------------------- */

/** RFC 5545 text: backslash, semicolon, comma and newline are escaped. */
const escapeText = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets are folded: CRLF, then a space, then the rest. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compact = (iso: string) => iso.replace(/-/g, "");

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A calendar file of every date still ahead, as all-day events. Deadlines get
 * two reminders — a week out and the day before — because the week-out one is
 * the one that leaves time to act. Start dates get none; nobody misses those.
 */
export function buildIcs(events: CalendarEvent[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Application Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:University applications",
  ];

  for (const e of events.filter((e) => e.daysAway >= 0)) {
    const who = e.programme ? `${e.school} — ${e.programme}` : e.school;
    const summary = e.kind === "start" ? `${who}: ${e.label}` : `Deadline: ${e.label} (${who})`;
    const description = [`As the school's page puts it: ${e.stated}`, e.notes, `Source: ${e.sourceUrl}`]
      .filter(Boolean)
      .join("\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@application-planner`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.iso)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(e.iso))}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `URL:${e.sourceUrl}`,
      "TRANSP:TRANSPARENT",
    );
    if (e.kind === "deadline") {
      for (const before of ["-P7D", "-P1D"]) {
        lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(summary)}`, `TRIGGER:${before}`, "END:VALARM");
      }
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
