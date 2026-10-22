"use client";

import { useId, useState } from "react";
import type { SavedSchool } from "@/lib/schema";
import { SchoolDetails, SchoolMeta, schoolSubtitle } from "./SchoolDetails";
import { SchoolModal } from "./SchoolModal";
import styles from "./SchoolEntry.module.css";

type Props = {
  school: SavedSchool;
  onUpdate: (id: string, patch: Partial<SavedSchool>) => void;
  onRemove: (id: string) => void;
};

/**
 * One school on the planner rail, in three depths: a row in the list, the
 * details unfolded beneath it, and — from there — the full view.
 */
export function SchoolEntry({ school, onUpdate, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [fullView, setFullView] = useState(false);
  const panelId = useId();
  const subtitle = schoolSubtitle(school);

  return (
    <li className={styles.entry} data-open={open || undefined}>
      <span className={styles.dot} aria-hidden="true" />

      <button
        type="button"
        className={styles.head}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <SchoolMeta school={school} />
        <h2 className={styles.name}>{school.info.name}</h2>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </button>

      <div className={styles.panel} id={panelId} hidden={!open}>
        <div className={styles.toolbar}>
          <button type="button" className={styles.expand} onClick={() => setFullView(true)}>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <path d="M7.5 1.5h3v3M4.5 10.5h-3v-3M10.5 1.5 7 5M1.5 10.5 5 7" />
            </svg>
            Open full view
          </button>
        </div>

        {/* The column is wide enough now for the full view's two-column layout. */}
        <SchoolDetails school={school} onUpdate={onUpdate} onRemove={onRemove} layout="columns" />
      </div>

      {fullView && (
        <SchoolModal
          school={school}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onClose={() => setFullView(false)}
        />
      )}
    </li>
  );
}
