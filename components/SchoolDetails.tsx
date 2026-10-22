"use client";

import {
  Award,
  CalendarDays,
  CircleHelp,
  ClipboardCheck,
  Clock,
  Coins,
  ListOrdered,
  MessageCircle,
  PenLine,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { createElement, useState } from "react";
import { STATUS_LABELS, type SavedSchool } from "@/lib/schema";
import { countdown, intakesOf, nextDeadline, withDays } from "@/lib/dates";
import { LinkedText } from "./LinkedText";
import { ScholarshipBadge } from "./ScholarshipBadge";
import { StickyNote } from "./StickyNote";
import styles from "./SchoolDetails.module.css";

type UpdateFn = (id: string, patch: Partial<SavedSchool>) => void;

function Section({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className ? `${styles.section} ${className}` : styles.section}>
      <h3 className={`eyebrow ${styles.sectionLabel}`}>
        <SectionIcon label={label} />
        {label}
      </h3>
      {children}
    </section>
  );
}

/** One small icon per kind of section, matched on its label. */
const SECTION_ICONS: [RegExp, LucideIcon][] = [
  [/^easy to miss/i, TriangleAlert],
  [/^dates|deadline/i, CalendarDays],
  [/^start/i, Clock],
  [/^how to apply/i, ListOrdered],
  [/^what you need|requirement/i, ClipboardCheck],
  [/^money|cost/i, Coins],
  [/^scholarship/i, Award],
  [/^ask someone|contact/i, MessageCircle],
  [/^still to check/i, CircleHelp],
  [/^your notes/i, PenLine],
];

function SectionIcon({ label }: { label: string }) {
  const icon = SECTION_ICONS.find(([re]) => re.test(label))?.[1];
  return icon
    ? createElement(icon, { className: styles.sectionIcon, size: 13, strokeWidth: 2, "aria-hidden": true })
    : null;
}

/** The chips above a school's name: sample flag, stage, and what's due next. */
export function SchoolMeta({ school }: { school: SavedSchool }) {
  const next = nextDeadline(school.info);
  return (
    <span className={styles.meta}>
      {school.demo && (
        <span className={`eyebrow ${styles.sample}`} title="Illustrative figures, not extracted from the site">
          Sample
        </span>
      )}
      <span className={`eyebrow ${styles.status}`} data-status={school.status}>
        {STATUS_LABELS[school.status]}
      </span>
      <ScholarshipBadge info={school.info} />
      {next && (
        <span className={`eyebrow ${styles.when}`} data-soon={next.daysAway <= 30 || undefined}>
          {next.label} · {countdown(next.daysAway)}
        </span>
      )}
    </span>
  );
}

export function schoolSubtitle(school: SavedSchool): string {
  const { programme, level, location } = school.info;
  return [programme, level, location].filter(Boolean).join(" · ");
}

type Props = {
  school: SavedSchool;
  onUpdate: UpdateFn;
  onRemove: (id: string) => void;
  /**
   * "stack" is the inline panel under a list entry. "columns" is the full view,
   * which has the width to put what you act on (steps, requirements, money
   * to find) beside what you check against (dates, fees, contacts).
   */
  layout?: "stack" | "columns";
};

/**
 * Everything known about one school. Rendered in two places — expanded in the
 * list, and in the full view — so both always show the same thing.
 */
export function SchoolDetails({ school, onUpdate, onRemove, layout = "stack" }: Props) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { info } = school;
  const deadlines = withDays(info.deadlines);

  const costRows = (
    [
      ["Application fee", info.costs.applicationFee],
      ["Tuition", info.costs.tuition],
      ["Living costs", info.costs.living],
      ["Notes", info.costs.notes],
    ] as [string, string | null][]
  ).filter((row): row is [string, string] => Boolean(row[1]));

  const intro = (
    <>
      <p className={styles.summary}><LinkedText text={info.summary} /></p>
      {info.applyUrl && (
        <a className={styles.apply} href={info.applyUrl} target="_blank" rel="noreferrer noopener">
          Start the application{info.applyVia ? ` · ${info.applyVia}` : ""} ↗
        </a>
      )}
    </>
  );

  const watchOuts = info.watchOuts.length > 0 && (
    <Section label="Easy to miss">
      <ul className={styles.watchOuts}>
        {info.watchOuts.map((item, i) => (
          <li key={i}><LinkedText text={item} /></li>
        ))}
      </ul>
    </Section>
  );

  const intakes = intakesOf(info);

  const dates = (deadlines.length > 0 || intakes.length > 0) && (
    <Section label="Dates">
      <ul className={styles.dates}>
        {intakes.map((d, i) => (
          <li key={`start-${i}`} className={styles.dateRow}>
            <span className={styles.dateLabel}>
              Classes start
              <span className={styles.dateNote}>{d.label}</span>
            </span>
            <span className={styles.dateValue}>{d.date}</span>
          </li>
        ))}
        {deadlines.map((d, i) => (
          <li key={i} className={styles.dateRow}>
            <span className={styles.dateLabel}>
              {d.label}
              {d.notes && <span className={styles.dateNote}><LinkedText text={d.notes} /></span>}
            </span>
            <span className={styles.dateValue}>
              {d.date}
              {d.daysAway !== null && d.daysAway >= 0 && (
                <span className={styles.dateCount} data-soon={d.daysAway <= 30 || undefined}>
                  {countdown(d.daysAway)}
                </span>
              )}
              {d.daysAway !== null && d.daysAway < 0 && <span className={styles.datePast}>passed</span>}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );

  const steps = info.steps.length > 0 && (
    <Section label="How to apply">
      <ol className={styles.steps}>
        {info.steps.map((step, i) => (
          <li key={i} className={styles.step}>
            <span className={styles.stepNum}>{String(i + 1).padStart(2, "0")}</span>
            <span>
              <strong className={styles.stepTitle}>{step.title}</strong>
              <span className={styles.stepDetail}><LinkedText text={step.detail} /></span>
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );

  const requirements = info.requirements.length > 0 && (
    <Section label="What you need">
      <div className={styles.groups}>
        {info.requirements.map((group, i) => (
          <div key={i} className={styles.group}>
            <h4 className={styles.groupName}>{group.category}</h4>
            <ul className={styles.bullets}>
              {group.items.map((item, j) => (
                <li key={j}><LinkedText text={item} /></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );

  const money = costRows.length > 0 && (
    <Section label="Money">
      <dl className={styles.facts}>
        {costRows.map(([label, value]) => (
          <div key={label} className={styles.fact}>
            <dt>{label}</dt>
            <dd><LinkedText text={value} /></dd>
          </div>
        ))}
      </dl>
    </Section>
  );

  const scholarships = info.scholarships.length > 0 && (
    <Section label={`Scholarships · ${info.scholarships.length}`}>
      <ul className={styles.scholarships}>
        {info.scholarships.map((s, i) => (
          <li key={i} className={styles.scholarship}>
            <div className={styles.scholarshipHead}>
              <strong>{s.name}</strong>
              {s.amount && <span className={styles.amount}>{s.amount}</span>}
            </div>
            {s.eligibility && <p className={styles.scholarshipBody}><LinkedText text={s.eligibility} /></p>}
            <div className={styles.scholarshipFoot}>
              {s.deadline && <span className="eyebrow">Closes {s.deadline}</span>}
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="eyebrow">
                  Details ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );

  const contacts = (info.contactEmail || info.contactPhone || info.contactUrl) && (
    <Section label="Ask someone">
      <ul className={styles.contacts}>
        {info.contactEmail && (
          <li>
            <a href={`mailto:${info.contactEmail}`}>{info.contactEmail}</a>
          </li>
        )}
        {info.contactPhone && <li>{info.contactPhone}</li>}
        {info.contactUrl && (
          <li>
            <a href={info.contactUrl} target="_blank" rel="noreferrer noopener">
              Admissions enquiries ↗
            </a>
          </li>
        )}
      </ul>
    </Section>
  );

  const stillToCheck = info.notFound.length > 0 && (
    <Section label={`Still to check yourself · ${info.notFound.length}`} className={styles.toCheck}>
      <ul className={styles.gaps}>
        {info.notFound.map((item, i) => (
          <li key={i}>
            <LinkedText text={item} />
          </li>
        ))}
      </ul>
    </Section>
  );

  const yours = (
    <>
      <Section label="Your notes">
        <StickyNote seed={school.id} tilt={-1} className={styles.noteSticky}>
          <textarea
            className={`hand ${styles.note}`}
            value={school.note}
            placeholder="Anything you want to remember about this one…"
            rows={layout === "columns" ? 4 : 3}
            onChange={(e) => onUpdate(school.id, { note: e.target.value })}
            aria-label="Your notes"
          />
        </StickyNote>
      </Section>

      <div className={styles.footer}>
        <label className={styles.statusPicker}>
          <span className="eyebrow">Stage</span>
          <select
            value={school.status}
            onChange={(e) => onUpdate(school.id, { status: e.target.value as SavedSchool["status"] })}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={styles.remove}
          data-confirm={confirmRemove || undefined}
          onClick={() => (confirmRemove ? onRemove(school.id) : setConfirmRemove(true))}
          onBlur={() => setConfirmRemove(false)}
        >
          <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" />
          {confirmRemove ? "Tap again to remove" : "Remove school"}
        </button>
      </div>
    </>
  );

  const sources = (
    <details className={styles.sources}>
      <summary className="eyebrow">
        Read from {school.pagesRead.length} page{school.pagesRead.length > 1 ? "s" : ""}
      </summary>
      <ul>
        {school.pagesRead.map((page) => (
          <li key={page}>
            <a href={page} target="_blank" rel="noreferrer noopener">
              {page}
            </a>
          </li>
        ))}
      </ul>
      {school.truncated && (
        <p className={styles.truncated}>
          Some pages were long and were read only in part — check anything critical against the site.
        </p>
      )}
    </details>
  );

  if (layout === "columns") {
    return (
      <div className={styles.columns}>
        <div className={styles.column}>
          {intro}
          {watchOuts}
          {steps}
          {requirements}
          {scholarships}
        </div>
        <aside className={`${styles.column} ${styles.side}`}>
          {dates}
          {money}
          {contacts}
          {stillToCheck}
          {yours}
          {sources}
        </aside>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      {intro}
      {watchOuts}
      {dates}
      {steps}
      {requirements}
      {money}
      {scholarships}
      {contacts}
      {stillToCheck}
      {yours}
      {sources}
    </div>
  );
}
