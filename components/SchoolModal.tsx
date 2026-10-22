"use client";

import { useEffect, useRef } from "react";
import type { SavedSchool } from "@/lib/schema";
import { SchoolDetails, SchoolMeta, schoolSubtitle } from "./SchoolDetails";
import styles from "./SchoolModal.module.css";

type Props = {
  school: SavedSchool;
  onUpdate: (id: string, patch: Partial<SavedSchool>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
};

/**
 * One school, full screen. Built on the native <dialog>: showModal() gives us
 * the top layer, a focus trap, Esc to close and focus handed back to whatever
 * opened it — all things a hand-rolled overlay gets subtly wrong.
 */
export function SchoolModal({ school, onUpdate, onRemove, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    // The page underneath shouldn't scroll while this one is up.
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";

    // Deliberately no dialog.close() here. Closing fires the "close" event,
    // which tells the parent to unmount us — so under Strict Mode's
    // mount/unmount/mount the dialog would open and immediately shut. Removing
    // the element on unmount already takes it out of the top layer.
    return () => {
      root.style.overflow = previous;
    };
  }, []);

  return (
    // The native "close" event fires for Esc as well as dialog.close(), so
    // this is the one place the parent hears about it.
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="school-modal-title"
      onClose={onClose}
    >
      <header className={styles.bar}>
        <span className="eyebrow">Full view</span>
        <button type="button" className={styles.close} onClick={() => ref.current?.close()}>
          Close
          <kbd className={styles.kbd}>Esc</kbd>
        </button>
      </header>

      <div className={styles.body}>
        <div className={styles.hero}>
          <SchoolMeta school={school} />
          <h2 id="school-modal-title" className={styles.title}>
            {school.info.name}
          </h2>
          {schoolSubtitle(school) && <p className={styles.subtitle}>{schoolSubtitle(school)}</p>}
        </div>

        <SchoolDetails
          school={school}
          onUpdate={onUpdate}
          onRemove={(id) => {
            onRemove(id);
            onClose();
          }}
          layout="columns"
        />
      </div>
    </dialog>
  );
}
