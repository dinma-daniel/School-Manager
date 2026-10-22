"use client";

import { useState } from "react";
import type { Programme, ProgrammeList } from "@/lib/programmes";
import styles from "./ProgrammePicker.module.css";

/** Each pick is a full extraction — enough to compare, not enough to run up a bill by accident. */
export const MAX_PICK = 20;

/** Rows rendered at once. A big school lists a thousand; nobody scrolls those, they filter. */
const MAX_ROWS = 300;

const OTHER = "Other";

type Props = {
  list: ProgrammeList;
  onRead: (picked: Programme[]) => void;
  onReadPage: () => void;
  onCancel: () => void;
};

export function ProgrammePicker({ list, onRead, onReadPage, onCancel }: Props) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  // A programme spanning levels counts, and shows, under each of them.
  const levelsOf = (p: Programme) => (p.levels?.length ? p.levels : p.level ? [p.level] : [OTHER]);
  const levels = new Map<string, number>();
  for (const p of list.programmes) for (const l of levelsOf(p)) levels.set(l, (levels.get(l) ?? 0) + 1);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = list.programmes.filter(
    (p) =>
      (level === null || levelsOf(p).includes(level)) &&
      words.every((w) => p.name.toLowerCase().includes(w) || p.url.toLowerCase().includes(w)),
  );

  const full = picked.size >= MAX_PICK;
  const unpickedShown = shown.filter((p) => !picked.has(p.url));
  const canPickShown = unpickedShown.length > 0 && picked.size + unpickedShown.length <= MAX_PICK;

  function toggle(url: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else if (next.size < MAX_PICK) next.add(url);
      return next;
    });
  }

  const chosen = list.programmes.filter((p) => picked.has(p.url));
  const anyGuessed = list.programmes.some((p) => p.nameFromUrl);

  return (
    <div className={styles.picker}>
      <div className={styles.head}>
        <span className="eyebrow">
          {list.programmes.length} programme{list.programmes.length === 1 ? "" : "s"}
          {list.school ? ` · ${list.school}` : ""}
        </span>
        <button type="button" className={styles.textButton} onClick={onCancel}>
          Start again
        </button>
      </div>

      {list.startIsProgramme && (
        <div className={styles.single}>
          <p>That link looks like a single course. Read it, or pick from the school&rsquo;s other programmes below.</p>
          <button type="button" className={styles.primary} onClick={onReadPage}>
            Read this course
          </button>
        </div>
      )}

      <input
        className={styles.search}
        type="search"
        placeholder="Filter, e.g. computer science or MSc"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Filter programmes"
        autoFocus={!list.startIsProgramme}
      />

      {levels.size > 1 && (
        <div className={styles.levels} role="group" aria-label="Study level">
          <button type="button" className={styles.chip} data-active={level === null || undefined} onClick={() => setLevel(null)}>
            All <span className={styles.chipCount}>{list.programmes.length}</span>
          </button>
          {[...levels.entries()]
            .sort(([a], [b]) => (a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b)))
            .map(([name, count]) => (
              <button
                key={name}
                type="button"
                className={styles.chip}
                data-active={level === name || undefined}
                onClick={() => setLevel(level === name ? null : name)}
              >
                {name} <span className={styles.chipCount}>{count}</span>
              </button>
            ))}
        </div>
      )}

      <ul className={styles.list}>
        {shown.length === 0 && <li className={styles.none}>Nothing matches that filter.</li>}
        {shown.slice(0, MAX_ROWS).map((p) => {
          const checked = picked.has(p.url);
          return (
            <li key={p.url}>
              <label className={styles.row} data-checked={checked || undefined} data-locked={(!checked && full) || undefined}>
                <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => toggle(p.url)} />
                <span className={styles.name}>
                  {p.name}
                  {p.nameFromUrl && (
                    <span className={styles.guess} title="Named from its web address — the real title may differ">
                      ~
                    </span>
                  )}
                </span>
                {levelsOf(p)[0] !== OTHER && <span className={styles.level}>{levelsOf(p).join(" · ")}</span>}
                <span className={styles.path}>{new URL(p.url).pathname}</span>
              </label>
            </li>
          );
        })}
        {shown.length > MAX_ROWS && (
          <li className={styles.none}>
            Showing {MAX_ROWS} of {shown.length}. Type to narrow it down.
          </li>
        )}
      </ul>

      <div className={styles.bulk}>
        <button
          type="button"
          className={styles.textButton}
          disabled={!canPickShown}
          onClick={() => setPicked((prev) => new Set([...prev, ...unpickedShown.map((p) => p.url)]))}
          title={canPickShown ? undefined : `Filter down to ${MAX_PICK} or fewer to select them all`}
        >
          Select all shown
        </button>
        <button type="button" className={styles.textButton} disabled={picked.size === 0} onClick={() => setPicked(new Set())}>
          Clear
        </button>
        <span className={styles.tally}>
          {picked.size} of up to {MAX_PICK} picked
        </span>
      </div>

      {anyGuessed && (
        <p className={styles.note}>
          Names marked ~ were read off the web address rather than a course list, so they may be approximate. The full
          read gets the real title.
        </p>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={chosen.length === 0} onClick={() => onRead(chosen)}>
          {chosen.length === 0 ? "Pick programmes to read" : `Read ${chosen.length} programme${chosen.length > 1 ? "s" : ""}`}
        </button>
        {!list.startIsProgramme && (
          <button type="button" className={styles.secondary} onClick={onReadPage}>
            Just read the page I pasted
          </button>
        )}
      </div>
    </div>
  );
}
