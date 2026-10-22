"use client";

import { useEffect, useRef } from "react";
import type { Access } from "@/lib/events";
import styles from "./AccessDialog.module.css";

export type AccessIssue = Access & {
  /** The programme's name, when it came from a batch of picks. */
  name?: string;
};

type Props = {
  issues: AccessIssue[];
  onClose: () => void;
  /** Close and put the cursor back in the link box. */
  onTryAnother: () => void;
};

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "That site";
  }
};

const COPY = {
  login: {
    title: "This page needs an account",
    body: (site: string) =>
      `${site} only shows this page to people who sign in or create an account. That's normal for application portals — it's where you apply, not where the course is described — and this app never asks for your details, so it can't go in for you.`,
    label: "needs an account",
    tips: [
      "Open it to sign in, or create an account when you're ready to apply.",
      "For the course details, look for the public programme page — usually under “Programs” or “Admissions” on the university's main site — and paste that link instead.",
    ],
  },
  blocked: {
    title: "This site doesn't allow automated reading",
    body: (site: string) =>
      `${site} only lets real web browsers in, so this app can't read its pages. Nothing is wrong with the link — it just has to be read by a person.`,
    label: "blocks automated reading",
    tips: [
      "Open it in your browser to read it yourself.",
      "If the school has pages on another of its sites — a graduate school or admissions site — try a link from there.",
    ],
  },
} as const;

/**
 * Why a page couldn't be read, when the reason is one the user can act on: a
 * login wall or a site that turns away anything but a browser. A popup rather
 * than a line of red text, because neither is an error — the link is fine, and
 * the user needs to know what to do instead.
 */
export function AccessDialog({ issues, onClose, onTryAnother }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // No close() on unmount — see SchoolModal for why.
  }, []);

  const single = issues.length === 1 ? issues[0] : null;
  const kinds = [...new Set(issues.map((i) => i.kind))];

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby="access-title" onClose={onClose}>
      <span className="eyebrow">Can&rsquo;t read {single ? "this page" : "these pages"}</span>
      <h2 id="access-title" className={styles.title}>
        {single ? COPY[single.kind].title : `${issues.length} pages couldn't be read`}
      </h2>

      {single ? (
        <p className={styles.body}>{COPY[single.kind].body(host(single.url))}</p>
      ) : (
        <ul className={styles.pages}>
          {issues.map((issue) => (
            <li key={issue.url}>
              <span className={styles.pageName}>{issue.name ?? host(issue.url)}</span>
              <span className={styles.pageWhy}>{COPY[issue.kind].label}</span>
              <a href={issue.url} target="_blank" rel="noreferrer noopener" className={styles.pageOpen}>
                Open ↗
              </a>
            </li>
          ))}
        </ul>
      )}

      <ul className={styles.tips}>
        {kinds.flatMap((kind) => COPY[kind].tips).map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>

      <div className={styles.actions}>
        {single && (
          <a className={styles.primary} href={single.url} target="_blank" rel="noreferrer noopener">
            Open {host(single.url)} ↗
          </a>
        )}
        <button
          type="button"
          className={single ? styles.secondary : styles.primary}
          onClick={() => {
            ref.current?.close();
            onTryAnother();
          }}
        >
          Paste a different link
        </button>
        <button type="button" className={styles.textButton} onClick={() => ref.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
}
