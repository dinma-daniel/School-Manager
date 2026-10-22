import styles from "./StickyNote.module.css";

export const STICKY_COLORS = ["yellow", "pink", "lavender", "mint", "blue", "peach"] as const;
export type StickyColor = (typeof STICKY_COLORS)[number];

/** The same seed always gets the same colour and tilt, so a note doesn't reshuffle on every render. */
function hash(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function stickyLook(seed: string): { color: StickyColor; tilt: number } {
  const h = hash(seed);
  return { color: STICKY_COLORS[h % STICKY_COLORS.length], tilt: ((h >> 3) % 5) - 2 }; // −2° … +2°
}

type Props = {
  /** Picks a colour and tilt that stay put; ignored where `color` is given. */
  seed?: string;
  color?: StickyColor;
  /** Degrees. Defaults to one derived from the seed. */
  tilt?: number;
  /** A strip of tape across the top, for notes pinned to a board. */
  tape?: boolean;
  /** Its place in the drop-in cascade when several land at once. */
  index?: number;
  className?: string;
  children: React.ReactNode;
};

/**
 * A square of coloured paper, a little crooked. The ink stays dark in every
 * theme — it's paper, and paper doesn't go dark when the room does.
 */
export function StickyNote({ seed = "", color, tilt, tape, index = 0, className, children }: Props) {
  const look = stickyLook(seed);
  return (
    <div
      className={`${styles.note} ${className ?? ""}`}
      data-color={color ?? look.color}
      data-tape={tape || undefined}
      style={{ "--tilt": `${tilt ?? look.tilt}deg`, "--i": Math.min(index, 8) } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
