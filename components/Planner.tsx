"use client";

import { List, Scale, SquareKanban } from "lucide-react";
import { useRef, useState } from "react";
import { useSchools } from "@/lib/storage";
import { DEMO_SCHOOLS } from "@/lib/demo";
import { countdown, nextDeadline, urgency } from "@/lib/dates";
import { applyFilters, facets, feeRange, NO_FILTERS, type Filters } from "@/lib/filter";
import { AddSchool, type AddSchoolHandle } from "./AddSchool";
import { SchoolEntry } from "./SchoolEntry";
import { Compare } from "./Compare";
import { SchoolBoard } from "./SchoolBoard";
import { StickyNote } from "./StickyNote";
import { HowItWorks } from "./HowItWorks";
import { ScribbleArrow } from "./ScribbleArrow";
import { Tour, useTourSeen } from "./Tour";
import { SchoolFilters, useRates } from "./SchoolFilters";
import styles from "./Planner.module.css";

type View = "planner" | "board" | "compare";

/** Its place in the entrance cascade (see .enter in globals.css). */
const order = (i: number) => ({ "--i": i }) as React.CSSProperties;

export function Planner() {
  const { schools, ready, add, update, remove } = useSchools();
  const [view, setView] = useState<View>("planner");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  /** The add form, which a saved course reopens to be swapped for another. */
  const addRef = useRef<AddSchoolHandle>(null);
  const [addBusy, setAddBusy] = useState(false);
  const tour = useTourSeen();
  // Once there's something saved to show round — and not while more is still being added.
  const touring = ready && schools.length > 0 && !tour.seen && !addBusy;

  // Whatever closes soonest goes to the top — that's the whole job of a planner.
  // Left unmemoized on purpose: the React Compiler handles it, and a manual
  // useMemo here only blocks it from doing so.
  const ordered = [...schools].sort((a, b) => urgency(a.info) - urgency(b.info));

  // Until a currency is picked, the range reads in the one most fees are in.
  const currency = filters.fee.currency || facets(schools).currencies[0]?.value || "USD";
  const { min, max } = feeRange(filters);
  const rates = useRates(min !== null || max !== null);
  const { shown, unknownFee } = applyFilters(
    ordered,
    { ...filters, fee: { ...filters.fee, currency } },
    rates.rates,
  );

  // "Next up" stays about everything saved: a filter narrows the list, not what's due.
  const soonest = ordered.find((school) => nextDeadline(school.info) !== null);
  const lede = soonest ? { school: soonest, next: nextDeadline(soonest.info)! } : null;

  return (
    <main className={styles.page}>
      {/* Decoration for the styles under review; each hides unless its style is on. */}
      {ready && (
        <span className={styles.ghost} aria-hidden="true">
          {String(schools.length).padStart(2, "0")}
        </span>
      )}
      <div className={styles.column}>
        <header className={styles.header}>
          <h1 className={styles.title}>
            <span className="mask">
              <span className="line" style={order(0)}>
                One link in.
              </span>
            </span>
            <br />
            <span className="mask">
              <span className={`line ${styles.titleAccent}`} style={order(1)}>
                The whole application out.
              </span>
            </span>
          </h1>
          <p className={`enter ${styles.blurb}`} style={order(3)}>
            University sites bury how to apply under four layers of navigation. Paste a course or admissions link and
            this pulls out the steps, the dates, the entry requirements, the money and the scholarships — without
            quietly dropping the awkward details.
          </p>
          <p className={`enter ${styles.doodle}`} style={order(4)} aria-hidden="true">
            paste any uni link — we&rsquo;ll do the digging ↓
          </p>
          {/* Only while nothing is saved: once something is, the page shouldn't need pointing at. */}
          {ready && schools.length === 0 && <ScribbleArrow className={styles.scribble} />}
        </header>

        <section className={`enter ${styles.add}`} style={order(5)}>
          <AddSchool ref={addRef} onAdd={add} onRemove={remove} onBusyChange={setAddBusy} />
        </section>

        {ready && schools.length > 0 && (
          <>
            {lede && (
              <aside className={`enter ${styles.lede}`} style={order(6)} data-tour="next-up">
                <span className="eyebrow">Next up</span>
                <p className={styles.ledeLine}>
                  <strong>{lede.school.info.name}</strong> — {lede.next.label.toLowerCase()} closes in{" "}
                  <span className={styles.ledeCount} data-soon={lede.next.daysAway <= 30 || undefined}>
                    {countdown(lede.next.daysAway).toLowerCase()}
                  </span>
                  , on {lede.next.date}.
                </p>
              </aside>
            )}

            {schools.some((s) => s.demo) && (
              <p className={styles.sampleNote}>
                Entries marked <strong>Sample</strong> are illustrative — the figures were not read from those
                universities&rsquo; sites. Remove them once you&rsquo;ve added your own.
              </p>
            )}

            <nav className={`enter ${styles.tabs}`} style={order(7)} aria-label="View">
              <button
                type="button"
                className={styles.tab}
                data-active={view === "planner" || undefined}
                onClick={() => setView("planner")}
              >
                <List className={styles.tabIcon} size={14} strokeWidth={1.9} aria-hidden="true" />
                Planner
                <span className={styles.count}>
                  {shown.length < schools.length ? `${shown.length}/${schools.length}` : schools.length}
                </span>
              </button>
              <button
                type="button"
                className={styles.tab}
                data-active={view === "board" || undefined}
                data-tour="board"
                onClick={() => setView("board")}
              >
                <SquareKanban className={styles.tabIcon} size={14} strokeWidth={1.9} aria-hidden="true" />
                Board
              </button>
              <button
                type="button"
                className={styles.tab}
                data-active={view === "compare" || undefined}
                data-tour="compare"
                onClick={() => setView("compare")}
              >
                <Scale className={styles.tabIcon} size={14} strokeWidth={1.9} aria-hidden="true" />
                Compare
              </button>
            </nav>

            {schools.length > 1 && (
              <SchoolFilters
                schools={schools}
                filters={filters}
                onChange={setFilters}
                currency={currency}
                shown={shown.length}
                unknownFee={unknownFee}
                rates={rates}
              />
            )}

            {/* Keyed by view, so switching views plays the cross-fade. */}
            <div key={view} className={styles.view}>
            {shown.length === 0 ? (
              <p className={styles.noMatch}>
                No saved schools match these filters.{" "}
                <button type="button" className={styles.noMatchClear} onClick={() => setFilters(NO_FILTERS)}>
                  Clear them
                </button>
              </p>
            ) : view === "planner" ? (
              <ul className={styles.rail}>
                {shown.map((school) => (
                  <SchoolEntry
                    key={school.id}
                    school={school}
                    onUpdate={update}
                    onRemove={remove}
                    onChangeCourse={(s) => addRef.current?.changeCourse(s)}
                  />
                ))}
              </ul>
            ) : view === "board" ? (
              <SchoolBoard schools={shown} onUpdate={update} onRemove={remove} />
            ) : (
              <Compare schools={shown} />
            )}
            </div>
          </>
        )}

        {ready && schools.length === 0 && (
          <section className={`board ${styles.empty}`}>
            <HowItWorks />
            <div className={styles.emptyNotes}>
            <StickyNote color="lavender" tilt={-2} tape index={0} className={styles.emptyNote}>
              <span className={styles.emptyLabel}>Nothing saved yet</span>
              <p>
                Start with the page you keep losing — a course page, an &ldquo;entry requirements&rdquo; page, an
                admissions homepage. Anything public works.
              </p>
            </StickyNote>
            <StickyNote color="yellow" tilt={3} index={1} className={styles.emptyNote}>
              <p className="hand">Just looking around? Load two samples and poke at them.</p>
              <button type="button" className={styles.noteButton} onClick={() => DEMO_SCHOOLS.forEach(add)}>
                Load samples
              </button>
            </StickyNote>
            </div>
          </section>
        )}

        <footer className={styles.footer}>
          <p>
            Everything you save stays in this browser. Always check a deadline against the school&rsquo;s own page
            before you rely on it.
          </p>
          {ready && schools.length > 0 && tour.seen && (
            <button
              type="button"
              className={styles.tourAgain}
              onClick={() => {
                // The tour starts on the list, where most of what it points at lives.
                setView("planner");
                tour.replay();
              }}
            >
              Show me around again
            </button>
          )}
        </footer>
      </div>

      {touring && <Tour onDone={tour.markSeen} />}
    </main>
  );
}
