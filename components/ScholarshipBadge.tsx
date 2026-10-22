import type { SchoolInfo } from "@/lib/schema";
import styles from "./ScholarshipBadge.module.css";

/**
 * Whether the pages offered any scholarship, bursary, grant or fee waiver.
 *
 * The red state says "none found", not "none exist": the brief only knows what
 * the pages it read mentioned, and a funding page it didn't reach can still
 * hold one. Claiming otherwise would break the never-invent rule.
 */
export function ScholarshipBadge({ info }: { info: SchoolInfo }) {
  const count = info.scholarships.length;
  return count > 0 ? (
    <span className={`eyebrow ${styles.badge}`} data-state="yes" title={info.scholarships.map((s) => s.name).join(", ")}>
      Scholarship available{count > 1 ? ` · ${count}` : ""}
    </span>
  ) : (
    <span
      className={`eyebrow ${styles.badge}`}
      data-state="no"
      title="None mentioned on the pages that were read. Check the school's funding page before ruling it out."
    >
      No scholarship found
    </span>
  );
}
