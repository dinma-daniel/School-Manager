"use client";

import { CalendarPlus, Clock, StickyNote as StickyNoteIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { buildIcs, calendarEvents, urgencyOf, type CalendarEvent } from "@/lib/calendar";
import { countdown } from "@/lib/dates";
import { useSchools } from "@/lib/storage";
import { Reveal } from "./Reveal";
import { SchoolModal } from "./SchoolModal";
import { StickyNote } from "./StickyNote";
import styles from "./CalendarView.module.css";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const isoOf = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function todayIso(): string {
  const now = new Date();
  return isoOf(now.getFullYear(), now.getMonth(), now.getDate());
}

/** A month as whole weeks, Monday first, with the neighbouring months' days filling the edges. */
function monthGrid(year: number, month: number): { iso: string; day: number; outside: boolean }[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((lead + days) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => {
    const date = new Date(year, month, i - lead + 1);
    return { iso: isoOf(date.getFullYear(), date.getMonth(), date.getDate()), day: date.getDate(), outside: date.getMonth() !== month };
  });
}

function download(events: CalendarEvent[]) {
  const blob = new Blob([buildIcs(events)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "university-applications.ics";
  a.click();
  URL.revokeObjectURL(url);
}

/** "Mon 12 Jan" from "2027-01-12". */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function CalendarView() {
  const { schools, ready, update, remove } = useSchools();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [openSchool, setOpenSchool] = useState<string | null>(null);
  // Which way the last month change went, so the grid slides in from that side.
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);

  const { dated, undated } = calendarEvents(schools);
  const upcoming = dated.filter((e) => e.daysAway >= 0);
  const passed = dated.filter((e) => e.daysAway < 0).reverse();
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of dated) byDay.set(e.iso, [...(byDay.get(e.iso) ?? []), e]);

  const today = todayIso();
  const grid = monthGrid(cursor.year, cursor.month);
  const shift = (by: number) => {
    setSelected(null);
    setDirection(by > 0 ? "next" : "prev");
    setCursor(({ year, month }) => {
      const d = new Date(year, month + by, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };
  const thisMonthCount = grid.filter((c) => !c.outside).reduce((n, c) => n + (byDay.get(c.iso)?.length ?? 0), 0);

  // Upcoming dates grouped under their month, in order.
  const months = new Map<string, CalendarEvent[]>();
  for (const e of upcoming) {
    const d = new Date(`${e.iso}T00:00:00`);
    const key = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    months.set(key, [...(months.get(key) ?? []), e]);
  }

  const school = openSchool ? schools.find((s) => s.id === openSchool) : undefined;

  const row = (e: CalendarEvent) => {
    const urgency = urgencyOf(e);
    return (
      <li key={e.id}>
        <button type="button" className={styles.event} data-urgency={urgency} onClick={() => setOpenSchool(e.schoolId)}>
          <span className={styles.eventDate}>
            <span className={styles.eventDay}>{Number(e.iso.slice(8, 10))}</span>
            <span className={styles.eventMonth}>{MONTHS[Number(e.iso.slice(5, 7)) - 1].slice(0, 3)}</span>
          </span>
          <span className={styles.eventBody}>
            <span className={styles.eventLabel}>
              {e.kind === "start" && <span className={styles.kind}>Starts</span>}
              {e.label}
            </span>
            <span className={styles.eventSchool}>
              {e.school}
              {e.programme ? ` · ${e.programme}` : ""}
            </span>
            {e.notes && <span className={styles.eventNote}>{e.notes}</span>}
          </span>
          <span className={styles.eventWhen}>
            {e.daysAway < 0 ? "Passed" : countdown(e.daysAway)}
          </span>
        </button>
      </li>
    );
  };

  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <header className={styles.header}>
          <span className="eyebrow">Calendar</span>
          <h1 className={styles.title}>
            <span className="mask">
              <span className="line">Every date, one place.</span>
            </span>
          </h1>
          <p className={`enter ${styles.blurb}`} style={{ "--i": 2 } as React.CSSProperties}>
            Deadlines and start dates from every school you&rsquo;ve saved. Pick a day to see what&rsquo;s on it, or a
            date below to open that school.
          </p>
        </header>

        {ready && schools.length === 0 && (
          <section className={styles.empty}>
            <p>Nothing saved yet, so there&rsquo;s nothing to put on the calendar.</p>
            <Link href="/" className={styles.button}>
              Add a school
            </Link>
          </section>
        )}

        {ready && schools.length > 0 && (
          <>
            <div className={`enter ${styles.exportRow}`} style={{ "--i": 3 } as React.CSSProperties}>
              <button
                type="button"
                className={styles.button}
                disabled={upcoming.length === 0}
                onClick={() => download(upcoming)}
              >
                <CalendarPlus className={styles.buttonIcon} size={16} strokeWidth={1.9} aria-hidden="true" />
                Add to my calendar
              </button>
              <p className={styles.exportNote}>
                {upcoming.length === 0
                  ? "No dates ahead to export."
                  : `Downloads ${upcoming.length} date${upcoming.length > 1 ? "s" : ""} for Google, Apple or Outlook calendar, with reminders a week and a day before each deadline.`}
              </p>
            </div>

            <section className={`enter ${styles.month}`} style={{ "--i": 4 } as React.CSSProperties} aria-label="Month view">
              <div className={styles.monthBar}>
                <h2 className={styles.monthName}>
                  {MONTHS[cursor.month]} <span className={styles.monthYear}>{cursor.year}</span>
                </h2>
                <span className={styles.monthCount}>
                  {thisMonthCount === 0 ? "Nothing this month" : `${thisMonthCount} date${thisMonthCount > 1 ? "s" : ""}`}
                </span>
                <div className={styles.monthNav}>
                  <button type="button" onClick={() => shift(-1)} aria-label="Previous month">
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      setSelected(null);
                      setDirection(null);
                      setCursor({ year: now.getFullYear(), month: now.getMonth() });
                    }}
                  >
                    Today
                  </button>
                  <button type="button" onClick={() => shift(1)} aria-label="Next month">
                    ›
                  </button>
                </div>
              </div>

              {/* Keyed by month, so stepping months replays the slide. */}
              <div key={`${cursor.year}-${cursor.month}`} className={styles.grid} data-direction={direction ?? undefined} role="grid">
                {WEEKDAYS.map((d) => (
                  <span key={d} className={styles.weekday} role="columnheader">
                    {d}
                  </span>
                ))}
                {grid.map((cell) => {
                  const events = byDay.get(cell.iso) ?? [];
                  const has = events.length > 0;
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      role="gridcell"
                      className={styles.cell}
                      data-outside={cell.outside || undefined}
                      data-today={cell.iso === today || undefined}
                      data-selected={selected === cell.iso || undefined}
                      data-has={has || undefined}
                      disabled={!has}
                      onClick={() => setSelected(selected === cell.iso ? null : cell.iso)}
                      aria-label={has ? `${shortDate(cell.iso)}: ${events.length} date${events.length > 1 ? "s" : ""}` : undefined}
                    >
                      <span className={styles.cellDay}>{cell.day}</span>
                      {events.slice(0, 2).map((e) => (
                        <span key={e.id} className={styles.chip} data-urgency={urgencyOf(e)} data-kind={e.kind}>
                          {e.school}
                        </span>
                      ))}
                      {events.length > 2 && <span className={styles.more}>+{events.length - 2}</span>}
                      {/* Narrow screens have no room for names; a dot per date instead. */}
                      <span className={styles.dots} aria-hidden="true">
                        {events.slice(0, 3).map((e) => (
                          <span key={e.id} data-urgency={urgencyOf(e)} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selected && (
                <div className={styles.dayPanel}>
                  <span className="eyebrow">{shortDate(selected)}</span>
                  <ul className={styles.events}>{(byDay.get(selected) ?? []).map(row)}</ul>
                </div>
              )}

              <ul className={styles.legend} aria-label="Key">
                <li data-urgency="now">Within a week</li>
                <li data-urgency="soon">Within a month</li>
                <li data-urgency="later">Later</li>
                <li data-urgency="past">Passed</li>
              </ul>
            </section>

            <Reveal as="section" className={styles.agenda}>
              <h2 className={`eyebrow ${styles.heading}`}>
                <Clock size={13} strokeWidth={2} aria-hidden="true" />
                Coming up
              </h2>
              {upcoming.length === 0 ? (
                <p className={styles.thin}>No dates ahead in what you&rsquo;ve saved.</p>
              ) : (
                [...months.entries()].map(([month, events]) => (
                  <div key={month} className={styles.agendaMonth}>
                    <h3 className={styles.agendaMonthName}>{month}</h3>
                    <ul className={styles.events}>{events.map(row)}</ul>
                  </div>
                ))
              )}
            </Reveal>

            {undated.length > 0 && (
              <Reveal as="section" className={styles.agenda}>
                <h2 className={`eyebrow ${styles.heading}`}>
                  <StickyNoteIcon size={13} strokeWidth={2} aria-hidden="true" />
                  No fixed date
                </h2>
                <p className={styles.thin}>
                  The school&rsquo;s page gave these as words rather than a day, so they can&rsquo;t sit on the calendar.
                </p>
                <ul className={`board ${styles.undated}`}>
                  {undated.map((u, i) => (
                    <li key={u.id}>
                      <StickyNote seed={u.id} tape index={i}>
                        <button type="button" className={styles.undatedOpen} onClick={() => setOpenSchool(u.schoolId)}>
                          <span className={`hand ${styles.undatedWhen}`}>{u.stated}</span>
                          <span className={styles.undatedLabel}>{u.label}</span>
                          <span className={styles.undatedSchool}>
                            {u.school}
                            {u.programme ? ` · ${u.programme}` : ""}
                          </span>
                        </button>
                      </StickyNote>
                    </li>
                  ))}
                </ul>
              </Reveal>
            )}

            {passed.length > 0 && (
              <details className={styles.passed}>
                <summary className="eyebrow">Already passed · {passed.length}</summary>
                <ul className={styles.events}>{passed.map(row)}</ul>
              </details>
            )}
          </>
        )}
      </div>

      {school && (
        <SchoolModal school={school} onUpdate={update} onRemove={remove} onClose={() => setOpenSchool(null)} />
      )}
    </main>
  );
}
