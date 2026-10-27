"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { SavedSchool } from "@/lib/schema";
import { ConfirmRemove } from "./ConfirmRemove";
import { SchoolDetails, SchoolMeta, schoolSubtitle } from "./SchoolDetails";
import { SchoolModal } from "./SchoolModal";
import styles from "./SchoolEntry.module.css";

type Props = {
  school: SavedSchool;
  onUpdate: (id: string, patch: Partial<SavedSchool>) => void;
  onRemove: (id: string) => void;
  /** Swap it for another course from the list it was picked from. Only offered where that list is known. */
  onChangeCourse?: (school: SavedSchool) => void;
};

/** How far a short swipe leaves the row open, showing the Remove button. */
const REVEAL = 96;
/** Past this share of the row's width, letting go asks straight away. */
const FAR = 0.5;

/**
 * One school on the rail, in three depths: a row in the list, the
 * details unfolded beneath it, and — from there — the full view.
 *
 * On touch screens a closed row also swipes left: a short swipe uncovers a
 * Remove button, a long one goes straight to the confirm. Either way nothing
 * is deleted until the confirm says so.
 */
export function SchoolEntry({ school, onUpdate, onRemove, onChangeCourse }: Props) {
  const [open, setOpen] = useState(false);
  const [fullView, setFullView] = useState(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const panelId = useId();
  const subtitle = schoolSubtitle(school);

  const swipeRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; from: number; axis: "x" | "y" | null } | null>(null);
  /** Set when a gesture was a swipe, so the click that follows doesn't also toggle the row. */
  const swiped = useRef(false);

  const revealed = offset !== 0 && !dragging;
  const changeable = Boolean(onChangeCourse && school.pickedFrom);

  // While the button is showing, a tap anywhere else puts the row back.
  useEffect(() => {
    if (!revealed || confirming) return;
    const close = (e: PointerEvent) => {
      if (!swipeRef.current?.contains(e.target as Node)) setOffset(0);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [revealed, confirming]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch" || open) return;
    gesture.current = { x: e.clientX, y: e.clientY, from: offset, axis: null };
    swiped.current = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;

    if (!g.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (g.axis === "y") {
        gesture.current = null;
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      swiped.current = true;
      setDragging(true);
    }

    // Left only; a little give past the right edge so it doesn't feel stuck.
    const next = g.from + dx;
    setOffset(next > 0 ? next * 0.2 : Math.max(next, -(swipeRef.current?.offsetWidth ?? 400)));
  };

  const onPointerEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.axis) return;
    setDragging(false);

    const width = swipeRef.current?.offsetWidth ?? 400;
    if (offset < -width * FAR) {
      setOffset(-REVEAL);
      setConfirming(true);
    } else {
      setOffset(offset < -REVEAL / 2 ? -REVEAL : 0);
    }
  };

  return (
    <li className={styles.entry} data-open={open || undefined}>
      <span className={styles.dot} aria-hidden="true" />

      <div
        ref={swipeRef}
        className={styles.swipe}
        data-swiped={offset < 0 || undefined}
        data-changeable={changeable || undefined}
      >
        <button
          type="button"
          className={styles.swipeRemove}
          onClick={() => setConfirming(true)}
          tabIndex={revealed ? 0 : -1}
          aria-hidden={!revealed}
        >
          <span className={styles.swipeLabel}>
            <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
            Remove
          </span>
        </button>

        <button
          type="button"
          className={styles.head}
          data-dragging={dragging || undefined}
          style={offset ? { transform: `translateX(${offset}px)` } : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClick={() => {
            if (swiped.current) {
              swiped.current = false;
              return;
            }
            // A tap on an uncovered row just covers it again.
            if (offset) return setOffset(0);
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          aria-controls={panelId}
          data-tour="entry"
        >
          <SchoolMeta school={school} />
          <h2 className={styles.name}>{school.info.name}</h2>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </button>

        {/* Beside the row rather than in it: the row is itself a button. */}
        {changeable && (
          <button
            type="button"
            className={styles.change}
            data-tour="change"
            onClick={() => onChangeCourse?.(school)}
            tabIndex={offset ? -1 : 0}
            aria-hidden={offset ? true : undefined}
            aria-label={`Change ${school.info.name} to a different course`}
          >
            Change to a different course
          </button>
        )}
      </div>

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

      {confirming && (
        <ConfirmRemove
          name={school.info.name}
          onConfirm={() => onRemove(school.id)}
          onCancel={() => {
            setConfirming(false);
            setOffset(0);
          }}
        />
      )}
    </li>
  );
}
