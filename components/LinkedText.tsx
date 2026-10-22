import styles from "./LinkedText.module.css";

/** An address, optionally wrapped in the brackets the brief puts around it. */
const LINK = /\(?(https?:\/\/[^\s)\]>"]+?)[.,;:!?]*\)?(?=[\s.,;:!?]|$)/g;

/** "https://www.uwaterloo.ca/finance/graduate-tuition/" → "uwaterloo.ca/finance/graduate-tuition". */
function label(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    const short = path.length > 32 ? `${path.slice(0, 30)}…` : path;
    return u.hostname.replace(/^www\./, "") + short;
  } catch {
    return url;
  }
}

/**
 * Brief text with its addresses made clickable. The brief ends a sentence
 * with the page it points to; shown in full, those addresses would swamp the
 * sentence, so each becomes a short "site/path ↗" link instead.
 */
export function LinkedText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const start = m.index ?? 0;
    parts.push(text.slice(last, start));
    parts.push(
      <a key={start} className={styles.link} href={m[1]} target="_blank" rel="noreferrer noopener" title={m[1]}>
        {label(m[1])} ↗
      </a>,
    );
    // Keep the full stop that ended the sentence after the address.
    const trailing = m[0].replace(/\)$/, "").match(/[.,;:!?]+$/)?.[0] ?? "";
    parts.push(trailing);
    last = start + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
