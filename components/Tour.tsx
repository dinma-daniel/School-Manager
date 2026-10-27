"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./Tour.module.css";

/**
 * A short guided look round the planner, shown once after the first school is
 * saved: each step lights up one feature and says what it's for, so the board,
 * the comparison and the calendar export aren't left undiscovered.
 *
 * Steps point at elements marked `data-tour="…"`; one whose element isn't on
 * the page (no "change course" on a pasted single course, no "Next up" without
 * dates) is skipped rather than shown pointing at nothing.
 */

type Step = { target: string; title: string; body: string };

const STEPS: Step[] = [
  {
    target: "entry",
    title: "Your school's brief",
    body: "Tap a school to unfold it: how to apply, the deadlines, entry requirements, fees and scholarships. “Easy to miss” flags the details that quietly cost people their place.",
  },
  {
    target: "status",
    title: "Track where you are",
    body: "Each school has a stage — Considering, Applying, Submitted, Offer. Change it, and keep your own notes, inside the unfolded school.",
  },
  {
    target: "change",
    title: "Picked the wrong course?",
    body: "Swap it for another from the same school's list. The stage and your notes come with it.",
  },
  {
    target: "next-up",
    title: "Next up",
    body: "The closest deadline across everything you've saved, always at the top.",
  },
  {
    target: "board",
    title: "Board",
    body: "Your schools as cards in columns by stage. Drag a card to move it along.",
  },
  {
    target: "compare",
    title: "Compare",
    body: "Pick schools to see fees, deadlines and requirements side by side.",
  },
  {
    target: "calendar",
    title: "Calendar",
    body: "Every deadline on a month view — and “Add to my calendar” puts them in Google, Apple or Outlook.",
  },
  {
    target: "add",
    title: "Add the next one",
    body: "Paste another school or course. With two or more saved, filters appear for level, fees, start date and stage.",
  },
];

/* Seen-or-not lives in this browser, read through a store so the server render
 * and the first client render agree (both say "seen" until hydrated). */
const SEEN_KEY = "uniapp-tour-seen";
const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};
let memorySeen = false;
function readSeen(): boolean {
  try {
    return memorySeen || localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return memorySeen;
  }
}
function writeSeen(seen: boolean) {
  memorySeen = seen;
  try {
    if (seen) localStorage.setItem(SEEN_KEY, "1");
    else localStorage.removeItem(SEEN_KEY);
  } catch {
    // Private window: it just won't be remembered past this visit.
  }
  listeners.forEach((notify) => notify());
}

/** Whether the tour has been seen in this browser, and ways to mark it or ask for it again. */
export function useTourSeen() {
  const seen = useSyncExternalStore(subscribe, readSeen, () => true);
  return { seen, markSeen: useCallback(() => writeSeen(true), []), replay: useCallback(() => writeSeen(false), []) };
}

/** Space between the lit element and its outline, and between the outline and the card. */
const PAD = 6;
const GAP = 14;
/** Below this width the card docks to the bottom of the screen instead of following the element. */
const DOCK_BELOW = 640;
/** A beat before the first step, so the new school has finished arriving. */
const START_DELAY_MS = 700;

type Box = { top: number; left: number; width: number; height: number };

const findTarget = (name: string) => document.querySelector<HTMLElement>(`[data-tour="${name}"]`);

/** Whether an element rides in a fixed or sticky bar, like the app's top navigation. */
function inPinnedBar(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const position = getComputedStyle(node).position;
    if (position === "fixed" || position === "sticky") return true;
  }
  return false;
}

export function Tour({ onDone }: { onDone: () => void }) {
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [card, setCard] = useState<{ top: number; left: number } | null>(null);
  /** On phones the card docks to an edge — the one away from what's lit. */
  const [docked, setDocked] = useState<"top" | "bottom" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Only the steps whose feature is on the page, worked out when the tour opens.
  const [steps, setSteps] = useState<Step[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const present = STEPS.filter((s) => findTarget(s.target));
      if (present.length === 0) return onDone();
      setSteps(present);
      setStarted(true);
    }, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  const step = steps[index];

  // Bring the step's element into view, then keep the outline and card on it
  // through the smooth scroll and any resize.
  useLayoutEffect(() => {
    if (!started || !step) return;
    const el = findTarget(step.target);
    if (!el) return;
    // Something in the sticky bar is always on screen; scrolling "to" it only
    // moves the page out from under the rest of the tour.
    if (!inPinnedBar(el)) el.scrollIntoView({ behavior: "smooth", block: "center" });

    let frame = 0;
    const place = () => {
      const r = el.getBoundingClientRect();
      const lit = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
      setBox(lit);

      // A short page can't always scroll the element clear of a bottom-docked
      // card, so the card moves to the top when the element is low down.
      const dock = window.innerWidth < DOCK_BELOW;
      setDocked(dock ? (lit.top + lit.height / 2 > window.innerHeight / 2 ? "top" : "bottom") : null);
      const c = cardRef.current;
      if (dock || !c) return setCard(null);
      const w = c.offsetWidth;
      const h = c.offsetHeight;
      const below = lit.top + lit.height + GAP;
      const top = below + h <= window.innerHeight - 16 ? below : Math.max(16, lit.top - GAP - h);
      const left = Math.min(Math.max(16, lit.left), window.innerWidth - w - 16);
      setCard({ top, left });
    };
    // Follow the element for as long as the scroll takes to settle.
    const until = performance.now() + 900;
    const follow = () => {
      place();
      if (performance.now() < until) frame = requestAnimationFrame(follow);
    };
    follow();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    nextRef.current?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [started, step]);

  const last = index === steps.length - 1;
  const next = useCallback(() => (last ? onDone() : setIndex((i) => i + 1)), [last, onDone]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [started, next, back, onDone]);

  if (!started || !step) return null;

  return (
    <div className={styles.layer}>
      {/* Catches clicks so the page underneath can't be changed mid-tour. */}
      <div className={styles.catcher} aria-hidden="true" />
      {box && <div className={styles.spotlight} style={box} aria-hidden="true" />}

      <div
        ref={cardRef}
        className={styles.card}
        data-docked={docked ?? undefined}
        style={card ?? undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
      >
        <div className={styles.head}>
          <span className="eyebrow">
            {index + 1} of {steps.length}
          </span>
          <button type="button" className={styles.skip} onClick={onDone}>
            Skip tour
          </button>
        </div>
        {/* Keyed by step, so each one plays its entrance. */}
        <div key={step.target} className={styles.body}>
          <h2 id="tour-title" className={styles.title}>
            {step.title}
          </h2>
          <p id="tour-body" className={styles.text}>
            {step.body}
          </p>
        </div>
        <div className={styles.foot}>
          <span className={styles.dots} aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.target} className={styles.dot} data-on={i === index || undefined} />
            ))}
          </span>
          <span className={styles.actions}>
            {index > 0 && (
              <button type="button" className={styles.back} onClick={back}>
                Back
              </button>
            )}
            <button ref={nextRef} type="button" className={styles.next} onClick={next}>
              {last ? "Got it" : "Next"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
