import styles from "./ScribbleArrow.module.css";

/**
 * A hand-drawn arrow with a loop in it, like a note scrawled in a margin
 * pointing at the thing to do next. Draws itself in on arrival; decorative,
 * so hidden from screen readers.
 */
export function ScribbleArrow({ className }: { className?: string }) {
  return (
    <svg className={`${styles.arrow} ${className ?? ""}`} viewBox="0 0 160 200" fill="none" aria-hidden="true">
      <path
        className={styles.stroke}
        pathLength={1}
        d="M150 16 C 112 6, 66 18, 58 58 C 52 88, 92 104, 98 82 C 104 60, 70 58, 58 84 C 46 110, 44 146, 46 182"
      />
      <path className={styles.head} pathLength={1} d="M30 164 L 46 184 L 62 162" />
    </svg>
  );
}
