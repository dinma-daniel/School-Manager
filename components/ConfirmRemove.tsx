"use client";

import { useEffect, useRef } from "react";
import styles from "./ConfirmRemove.module.css";

type Props = {
  name: string;
  onConfirm: () => void;
  /** Called however the dialog closes without removing: Cancel, Esc, or the backdrop. */
  onCancel: () => void;
};

/**
 * The last word before a school is deleted. A swipe is easy to do by accident,
 * so it never removes anything on its own — it only ever leads here.
 */
export function ConfirmRemove({ name, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirmed = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // No close() on unmount — see SchoolModal for why.
  }, []);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="confirm-remove-title"
      onClose={() => (confirmed.current ? onConfirm() : onCancel())}
      onClick={(e) => {
        // A tap on the backdrop lands on the dialog itself; treat it as Cancel.
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <h2 id="confirm-remove-title" className={styles.title}>
        Remove {name}?
      </h2>
      <p className={styles.body}>Its deadlines, notes and status go with it. This can&rsquo;t be undone.</p>

      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={() => ref.current?.close()} autoFocus>
          Cancel
        </button>
        <button
          type="button"
          className={styles.remove}
          onClick={() => {
            confirmed.current = true;
            ref.current?.close();
          }}
        >
          Remove
        </button>
      </div>
    </dialog>
  );
}
