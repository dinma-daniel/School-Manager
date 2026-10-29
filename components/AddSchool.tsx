"use client";

import { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from "react";
import { postForResult, StreamError } from "@/lib/events";
import type { Programme, ProgrammeList } from "@/lib/programmes";
import type { SavedSchool, SchoolInfo } from "@/lib/schema";
import { AccessDialog, type AccessIssue } from "./AccessDialog";
import { ProgrammePicker } from "./ProgrammePicker";
import styles from "./AddSchool.module.css";

type Phase =
  | { kind: "idle"; notice?: { text: string; failed: boolean } }
  | { kind: "finding"; status: string }
  | { kind: "picking"; list: ProgrammeList; sourceUrl: string }
  | { kind: "nolist"; sourceUrl: string; reason: string }
  | { kind: "reading"; done: number; total: number; current: string; status: string }
  | { kind: "error"; message: string };

type DoneEvent = { info: SchoolInfo; pagesRead: string[]; truncated: boolean };

/** A page to read: the link, the name it was picked by, and the list it was picked from. */
type Target = { url: string; name?: string; pickedFrom?: string };

/** What the planner can ask of the form from outside it. */
export type AddSchoolHandle = {
  /** Reopen the programme list a saved course came from, to swap it for another. */
  changeCourse: (school: SavedSchool) => void;
};

/** The course being swapped out, while its replacement is picked and read. */
type Replacing = { id: string; name: string };

/**
 * Phone width, the same 640px the layout breaks at. The placeholder can't be
 * swapped in CSS, and the full one is cut off mid-word on a phone.
 */
const PHONE = "(max-width: 640px)";
const subscribePhone = (onChange: () => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const usePhone = () =>
  useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
/** A login wall or a blocked site, if that's why it failed. */
const accessOf = (err: unknown) => (err instanceof StreamError ? err.access : undefined);

type Props = {
  onAdd: (school: SavedSchool) => void;
  /** Put a newly read course in place of a saved one, keeping the saved one's stage and note. */
  onReplace: (oldId: string, school: SavedSchool) => void;
  /** Told when a search or read starts and stops, so nothing opens over it. */
  onBusyChange?: (busy: boolean) => void;
  ref?: React.Ref<AddSchoolHandle>;
};

export function AddSchool({ onAdd, onReplace, onBusyChange, ref }: Props) {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [access, setAccess] = useState<AccessIssue[] | null>(null);
  const [replacing, setReplacingState] = useState<Replacing | null>(null);
  // Mirrored in a ref: the read loop runs across many renders and must see the latest.
  const replacingRef = useRef<Replacing | null>(null);
  const setReplacing = (next: Replacing | null) => {
    replacingRef.current = next;
    setReplacingState(next);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** The last list found, so changing a course just picked from it doesn't search the site again. */
  const listCache = useRef<{ sourceUrl: string; list: ProgrammeList } | null>(null);

  const phone = usePhone();
  const working = phase.kind === "finding" || phase.kind === "reading";
  // Picking counts as busy too: the user is mid-way through adding.
  const busy = working || phase.kind === "picking";
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  /** One full extraction, saved as its own entry — in place of the course being changed, if there is one. */
  async function readOne(target: Target, onStatus: (message: string) => void, signal: AbortSignal) {
    const result = await postForResult<DoneEvent>("/api/extract", { url: target.url }, onStatus, signal);
    const school: SavedSchool = {
      id: crypto.randomUUID(),
      sourceUrl: target.url,
      pagesRead: result.pagesRead,
      truncated: result.truncated,
      addedAt: new Date().toISOString(),
      // The model sometimes leaves the programme out when the page assumes it;
      // the user picked it by name, so we know it.
      info: target.name && !result.info.programme ? { ...result.info, programme: target.name } : result.info,
      status: "considering",
      note: "",
      pickedFrom: target.pickedFrom,
    };
    // Only a course picked from the list takes the old one's place — never
    // "Read this page anyway" — and only once it's safely read.
    const swap = target.pickedFrom ? replacingRef.current : null;
    if (swap) {
      onReplace(swap.id, school);
      setReplacing(null);
    } else {
      onAdd(school);
    }
  }

  /**
   * Read the picked pages one after another. In parallel would be quicker, but
   * free tiers meter tokens per minute and a local model runs one at a time —
   * so it would mostly be quicker at failing.
   */
  async function readAll(targets: Target[]) {
    const controller = new AbortController();
    abortRef.current = controller;
    const failures: string[] = [];
    const walled: AccessIssue[] = [];
    let added = 0;
    let outOfAllowance: string | null = null;

    for (const [i, target] of targets.entries()) {
      const current = target.name ?? "the page";
      setPhase({ kind: "reading", done: i, total: targets.length, current, status: "Opening the link" });
      try {
        await readOne(
          target,
          (status) => setPhase({ kind: "reading", done: i, total: targets.length, current, status }),
          controller.signal,
        );
        added++;
      } catch (err) {
        if (controller.signal.aborted) break;
        const blocked = accessOf(err);
        if (blocked && targets.length === 1) {
          setPhase({ kind: "idle" });
          setAccess([blocked]);
          abortRef.current = null;
          return;
        }
        // Collected for one popup at the end, not one per programme.
        if (blocked) {
          walled.push({ ...blocked, name: target.name });
          continue;
        }
        // One programme failing shouldn't cost the user the rest.
        if (targets.length === 1) {
          setPhase({ kind: "error", message: errorMessage(err) });
          abortRef.current = null;
          return;
        }
        // Once the day's allowance is gone, every remaining read would fail
        // the same way — say it once and stop, rather than once per programme.
        if (/today's free allowance/.test(errorMessage(err))) {
          outOfAllowance = errorMessage(err);
          break;
        }
        failures.push(`${current} (${errorMessage(err)})`);
      }
    }

    // A change that didn't go through leaves the old course where it was.
    setReplacing(null);

    if (outOfAllowance) {
      abortRef.current = null;
      const left = targets.length - added;
      setPhase({
        kind: "idle",
        notice: { text: `Added ${added} of ${targets.length}. ${outOfAllowance} The other ${left} weren't read.`, failed: true },
      });
      return;
    }

    abortRef.current = null;
    if (walled.length > 0) setAccess(walled);
    const stopped = controller.signal.aborted;
    if (!stopped && failures.length === 0 && walled.length === 0) {
      setUrl("");
      setPhase({ kind: "idle", notice: targets.length > 1 ? { text: `Added all ${added}.`, failed: false } : undefined });
      inputRef.current?.blur();
      return;
    }

    const parts = [stopped ? `Stopped. Added ${added}.` : `Added ${added} of ${targets.length}.`];
    if (walled.length > 0) parts.push(`${walled.length} can't be read automatically — see the popup for why.`);
    if (failures.length > 0) parts.push(`Couldn't read: ${failures.join("; ")}.`);
    setPhase({ kind: "idle", notice: { text: parts.join(" "), failed: failures.length > 0 || walled.length > 0 } });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || working) return;
    // A new link is a new search, not the change that may have been under way.
    setReplacing(null);
    findProgrammes(trimmed);
  }

  async function findProgrammes(trimmed: string) {
    setPhase({ kind: "finding", status: "Opening the link" });
    let list: ProgrammeList;
    try {
      list = await postForResult<ProgrammeList>("/api/programmes", { url: trimmed }, (status) =>
        setPhase({ kind: "finding", status }),
      );
    } catch (err) {
      // No list to pick from, so no change of course either: the old one stays.
      setReplacing(null);
      const blocked = accessOf(err);
      if (blocked) {
        setPhase({ kind: "idle" });
        setAccess([blocked]);
        return;
      }
      setPhase({ kind: "nolist", sourceUrl: trimmed, reason: errorMessage(err) });
      return;
    }

    if (list.programmes.length > 0) {
      listCache.current = { sourceUrl: trimmed, list };
      setPhase({ kind: "picking", list, sourceUrl: trimmed });
      return;
    }
    setReplacing(null);
    if (list.startIsProgramme) {
      await readAll([{ url: trimmed }]);
    } else {
      // Don't quietly read a homepage or an admissions overview: the brief
      // that comes back is a page of "not stated", and the user never learns
      // the programme they wanted was a couple of clicks away.
      setPhase({
        kind: "nolist",
        sourceUrl: trimmed,
        reason: "Couldn't find a list of programmes from that link.",
      });
    }
  }

  useImperativeHandle(ref, () => ({
    changeCourse(school) {
      const from = school.pickedFrom;
      if (!from || working) return;
      setReplacing({ id: school.id, name: school.info.programme ?? school.info.name });
      setUrl(from);
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const cached = listCache.current;
      if (cached?.sourceUrl === from) setPhase({ kind: "picking", list: cached.list, sourceUrl: from });
      else findProgrammes(from);
    },
  }));

  return (
    <div ref={rootRef} className={styles.form}>
      <form className={styles.field} onSubmit={submit} data-tour="add">
        <input
          ref={inputRef}
          className={styles.input}
          type="url"
          inputMode="url"
          placeholder={phone ? "Paste a School link" : "Paste a school, course list or course link"}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (phase.kind === "picking") setReplacing(null);
            if (phase.kind === "error" || phase.kind === "picking" || phase.kind === "nolist") setPhase({ kind: "idle" });
          }}
          disabled={working}
          aria-label="University or school page link"
        />
        {working ? (
          <button className={styles.submit} type="button" onClick={() => abortRef.current?.abort()} disabled={phase.kind !== "reading"}>
            {phase.kind === "reading" ? "Stop" : "Looking"}
          </button>
        ) : (
          <button className={styles.submit} type="submit" disabled={url.trim().length === 0}>
            Read it
          </button>
        )}
      </form>

      <div className={styles.status} role="status" aria-live="polite">
        {phase.kind === "finding" && (
          <span className={styles.working}>
            <span className={styles.pulse} aria-hidden="true" />
            {phase.status}…
          </span>
        )}
        {phase.kind === "reading" && (
          <span className={styles.working}>
            <span className={styles.pulse} aria-hidden="true" />
            {phase.total > 1 && (
              <span className={styles.progress}>
                {phase.done + 1} of {phase.total} · {phase.current} ·{" "}
              </span>
            )}
            {phase.status}…
          </span>
        )}
        {phase.kind === "error" && <span className={styles.error}>{phase.message}</span>}
        {phase.kind === "idle" &&
          (phase.notice ? (
            <span className={phase.notice.failed ? styles.error : styles.hint}>{phase.notice.text}</span>
          ) : (
            <span className={styles.hint}>
              Paste a school or course list and it finds the programmes for you to pick from. Paste a single course and
              it reads that, following the linked entry-requirement, fees and scholarship pages.
            </span>
          ))}
      </div>

      {phase.kind === "nolist" && (
        <div className={styles.nolist}>
          <p>
            <strong>{phase.reason}</strong> Open the school&rsquo;s site and paste the page that lists its programmes
            (usually called &ldquo;Programs&rdquo;, &ldquo;Courses&rdquo; or &ldquo;Degrees A&ndash;Z&rdquo;), or the
            page of the one course you want.
          </p>
          <div className={styles.nolistActions}>
            <button type="button" className={styles.secondary} onClick={() => readAll([{ url: phase.sourceUrl }])}>
              Read this page anyway
            </button>
            <button type="button" className={styles.textButton} onClick={() => setPhase({ kind: "idle" })}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {access && (
        <AccessDialog
          issues={access}
          onClose={() => setAccess(null)}
          onTryAnother={() => {
            setAccess(null);
            // After the dialog hands focus back, so the cursor lands in the box.
            requestAnimationFrame(() => inputRef.current?.select());
          }}
        />
      )}

      {phase.kind === "picking" && (
        <ProgrammePicker
          list={phase.list}
          replacing={replacing?.name}
          onRead={(picked: Programme[]) =>
            readAll(picked.map((p) => ({ url: p.url, name: p.name, pickedFrom: phase.sourceUrl })))
          }
          onReadPage={() => readAll([{ url: phase.sourceUrl }])}
          onCancel={() => {
            setReplacing(null);
            setPhase({ kind: "idle" });
          }}
        />
      )}
    </div>
  );
}
