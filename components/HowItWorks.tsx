import { CalendarHeart, FileText, Link2, ListChecks, PartyPopper, Plus, Telescope } from "lucide-react";
import styles from "./HowItWorks.module.css";

const STEPS = [
  { icon: Link2, label: "Paste any uni link" },
  { icon: Telescope, label: "We find every programme" },
  { icon: ListChecks, label: "Pick the ones you like" },
  { icon: FileText, label: "Get deadlines, fees & requirements" },
  { icon: CalendarHeart, label: "Plan it on your board & calendar" },
] as const;

/** A small tilt per step, so the pills look placed by hand rather than stacked. */
const TILTS = [-1.5, 1.2, -0.6, 1.6, -1];

/**
 * The whole app in five steps, as tilted pills on a winding dashed path, each
 * bend marked with a plus. Every other pill sits a little to the right, and
 * the path swings out to whichever side it's heading — so it reads as one line
 * snaking down the page.
 */
export function HowItWorks() {
  return (
    <div className={styles.wrap}>
      <span className="eyebrow">How it works</span>
      <ol className={styles.path}>
        {STEPS.map(({ icon: Icon, label }, i) => {
          const shifted = i % 2 === 1;
          const last = i === STEPS.length - 1;
          return (
            <li
              key={label}
              className={styles.step}
              data-shift={shifted || undefined}
              style={{ "--i": i, "--tilt": `${TILTS[i]}deg` } as React.CSSProperties}
            >
              <span className={styles.icon} aria-hidden="true">
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <span className={styles.label}>{label}</span>

              {!last && (
                <span className={styles.link} data-side={shifted ? "left" : "right"} aria-hidden="true">
                  <span className={styles.node}>
                    <Plus size={11} strokeWidth={2.25} />
                  </span>
                </span>
              )}

              {last && (
                <>
                  <span className={styles.tail} aria-hidden="true" />
                  <span className={styles.finish} aria-hidden="true">
                    <PartyPopper size={22} strokeWidth={1.6} />
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
