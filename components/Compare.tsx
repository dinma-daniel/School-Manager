"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { STATUS_LABELS, type SavedSchool } from "@/lib/schema";
import { countdown, intakesOf, nextDeadline } from "@/lib/dates";
import { ScholarshipBadge } from "./ScholarshipBadge";
import styles from "./Compare.module.css";

type Row = {
  label: string;
  value: (school: SavedSchool) => React.ReactNode;
};

const ROWS: Row[] = [
  {
    label: "Next deadline",
    value: (s) => {
      const next = nextDeadline(s.info);
      if (!next) return null;
      return (
        <span className={styles.stacked}>
          <span className={styles.strong}>{next.date}</span>
          <span className={styles.sub} data-soon={next.daysAway <= 30 || undefined}>
            {next.label} · {countdown(next.daysAway)}
          </span>
        </span>
      );
    },
  },
  {
    label: "Classes start",
    value: (s) => {
      const intakes = intakesOf(s.info);
      return intakes.length > 0 ? intakes.map((i) => i.date).join(" · ") : null;
    },
  },
  { label: "Level", value: (s) => s.info.level },
  { label: "Where", value: (s) => s.info.location },
  { label: "Apply via", value: (s) => s.info.applyVia },
  { label: "Application fee", value: (s) => s.info.costs.applicationFee },
  { label: "Tuition", value: (s) => s.info.costs.tuition },
  { label: "Living costs", value: (s) => s.info.costs.living },
  { label: "Scholarships", value: (s) => <ScholarshipBadge info={s.info} /> },
  { label: "Steps to apply", value: (s) => (s.info.steps.length > 0 ? `${s.info.steps.length}` : null) },
  {
    label: "Easy to miss",
    value: (s) =>
      s.info.watchOuts.length > 0 ? <span className={styles.warn}>{s.info.watchOuts.length}</span> : null,
  },
  { label: "Stage", value: (s) => STATUS_LABELS[s.status] },
];

const PICKED_KEY = "uniapp-compare";

/** The last selection, if this browser kept one. Only ids still saved count. */
function storedPick(schools: SavedSchool[]): string[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(PICKED_KEY) ?? "null");
    if (!Array.isArray(raw)) return null;
    const ids = new Set(schools.map((s) => s.id));
    return raw.filter((id): id is string => typeof id === "string" && ids.has(id));
  } catch {
    return null;
  }
}

function storePick(ids: string[]) {
  try {
    localStorage.setItem(PICKED_KEY, JSON.stringify(ids));
  } catch {
    // The choice just won't outlive this visit.
  }
}

/**
 * The side-by-side, for the schools you pick rather than everything saved —
 * comparing eight at once is a spreadsheet, not a decision. Starts on your
 * two most urgent; the choice is kept in this browser.
 */
export function Compare({ schools }: { schools: SavedSchool[] }) {
  // Only rendered on the client (the planner waits for storage), so reading
  // localStorage in the initialiser is safe.
  const [picked, setPicked] = useState<string[]>(() => storedPick(schools) ?? schools.slice(0, 2).map((s) => s.id));

  if (schools.length < 2) {
    return (
      <p className={styles.thin}>
        Add a second school and this becomes a side-by-side — deadlines, fees and scholarships lined up in one grid.
      </p>
    );
  }

  const choose = (ids: string[]) => {
    setPicked(ids);
    storePick(ids);
  };
  const toggle = (id: string) => choose(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);

  // In the order they were picked; a school removed since just drops out.
  const byId = new Map(schools.map((s) => [s.id, s]));
  const shown = picked.map((id) => byId.get(id)).filter((s): s is SavedSchool => Boolean(s));

  return (
    <div className={styles.compare}>
      <div className={styles.picker}>
        <div className={styles.pickerHead}>
          <span className="eyebrow">Pick schools to compare</span>
          <span className={styles.pickerCount}>
            {shown.length} of {schools.length} picked
          </span>
          <button type="button" className={styles.pickerAction} onClick={() => choose(schools.map((s) => s.id))}>
            All
          </button>
          <button type="button" className={styles.pickerAction} onClick={() => choose([])} disabled={shown.length === 0}>
            Clear
          </button>
        </div>
        <ul className={styles.chips}>
          {schools.map((s) => {
            const on = picked.includes(s.id);
            return (
              <li key={s.id}>
                <button type="button" className={styles.chip} data-on={on || undefined} aria-pressed={on} onClick={() => toggle(s.id)}>
                  <span className={styles.tick} aria-hidden="true">
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className={styles.chipName}>{s.info.name}</span>
                  {s.info.programme && <span className={styles.chipProgramme}>{s.info.programme}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {shown.length < 2 ? (
        <p className={styles.thin}>
          {shown.length === 0 ? "Pick two or more schools above to line them up side by side." : "Pick one more to compare."}
        </p>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.corner}>
                  <span className="eyebrow">Compare</span>
                </th>
                {shown.map((s) => (
                  <th key={s.id} scope="col" className={styles.school}>
                    <span className={styles.schoolHead}>
                      <span>
                        {s.info.name}
                        {s.info.programme && <span className={styles.programme}>{s.info.programme}</span>}
                      </span>
                      <button
                        type="button"
                        className={styles.drop}
                        onClick={() => toggle(s.id)}
                        aria-label={`Take ${s.info.name} out of the comparison`}
                        title="Take out of the comparison"
                      >
                        <X size={13} strokeWidth={2.25} aria-hidden="true" />
                      </button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className={styles.rowLabel}>
                    {row.label}
                  </th>
                  {shown.map((s) => {
                    const value = row.value(s);
                    return (
                      <td key={s.id} className={styles.cell}>
                        {value ?? <span className={styles.empty}>—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
