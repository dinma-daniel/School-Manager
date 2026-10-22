"use client";

import { Archive, Lightbulb, PartyPopper, PenLine, Send, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { countdown, nextDeadline } from "@/lib/dates";
import { STATUS_LABELS, type SavedSchool } from "@/lib/schema";
import { SchoolModal } from "./SchoolModal";
import { StickyNote } from "./StickyNote";
import styles from "./SchoolBoard.module.css";

type Status = SavedSchool["status"];
const COLUMNS = Object.keys(STATUS_LABELS) as Status[];

const ICON: Record<Status, LucideIcon> = {
  considering: Lightbulb,
  applying: PenLine,
  submitted: Send,
  offer: PartyPopper,
  rejected: Archive,
};

const HINT: Record<Status, string> = {
  considering: "Still deciding",
  applying: "Working on it",
  submitted: "Sent — now wait",
  offer: "They said yes",
  rejected: "Closed or withdrawn",
};

type Props = {
  schools: SavedSchool[];
  onUpdate: (id: string, patch: Partial<SavedSchool>) => void;
  onRemove: (id: string) => void;
};

/**
 * The saved schools as sticky notes on a board, one column per stage. Drag a
 * note to move it on; the arrows do the same for touch screens and keyboards,
 * where dragging isn't an option.
 */
export function SchoolBoard({ schools, onUpdate, onRemove }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const move = (id: string, status: Status) => onUpdate(id, { status });
  const opened = open ? schools.find((s) => s.id === open) : undefined;

  return (
    <div className={styles.wrap}>
      <div className={`board ${styles.board}`}>
        {COLUMNS.map((status, col) => {
          const here = schools.filter((s) => s.status === status);
          const Icon = ICON[status];
          return (
            <section
              key={status}
              className={styles.column}
              data-over={over === status || undefined}
              aria-label={STATUS_LABELS[status]}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                if (id) move(id, status);
                setOver(null);
                setDragging(null);
              }}
            >
              <header className={styles.head}>
                <h3 className={styles.title}>
                  <span className={styles.colIcon} aria-hidden="true">
                    <Icon size={13} strokeWidth={2} />
                  </span>
                  {STATUS_LABELS[status]}
                  <span className={styles.count}>{here.length}</span>
                </h3>
                <span className={`hand ${styles.hint}`}>{HINT[status]}</span>
              </header>

              <ul className={styles.notes}>
                {here.map((s, i) => {
                  const next = nextDeadline(s.info);
                  const prev = COLUMNS[col - 1];
                  const nextCol = COLUMNS[col + 1];
                  return (
                    <li
                      key={s.id}
                      draggable
                      className={styles.item}
                      data-dragging={dragging === s.id || undefined}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", s.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(s.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                    >
                      <StickyNote seed={s.id} tape index={i}>
                        <button type="button" className={styles.open} onClick={() => setOpen(s.id)}>
                          <span className={styles.name}>{s.info.name}</span>
                          {s.info.programme && <span className={styles.programme}>{s.info.programme}</span>}
                        </button>

                        {next ? (
                          <p className={styles.due} data-soon={next.daysAway <= 7 || undefined}>
                            {next.label} · {countdown(next.daysAway).toLowerCase()}
                          </p>
                        ) : (
                          <p className={styles.due}>No date ahead</p>
                        )}

                        {s.note && <p className={`hand ${styles.scribble}`}>{s.note}</p>}

                        <div className={styles.moves}>
                          <button
                            type="button"
                            disabled={!prev}
                            onClick={() => prev && move(s.id, prev)}
                            aria-label={prev ? `Move back to ${STATUS_LABELS[prev]}` : undefined}
                          >
                            ‹
                          </button>
                          <button
                            type="button"
                            disabled={!nextCol}
                            onClick={() => nextCol && move(s.id, nextCol)}
                            aria-label={nextCol ? `Move on to ${STATUS_LABELS[nextCol]}` : undefined}
                          >
                            ›
                          </button>
                        </div>
                      </StickyNote>
                    </li>
                  );
                })}
                {here.length === 0 && <li className={styles.emptyCol}>Drop a school here</li>}
              </ul>
            </section>
          );
        })}
      </div>

      {opened && <SchoolModal school={opened} onUpdate={onUpdate} onRemove={onRemove} onClose={() => setOpen(null)} />}
    </div>
  );
}
