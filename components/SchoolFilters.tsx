"use client";

import { useEffect, useId, useState } from "react";
import { activeCount, facets, NO_FILTERS, type Filters, type Option } from "@/lib/filter";
import type { Rates } from "@/lib/money";
import { STATUS_LABELS, type SavedSchool } from "@/lib/schema";
import styles from "./SchoolFilters.module.css";

/** Offered whatever's saved, so a budget can be set in the currency you think in. */
const COMMON_CURRENCIES = ["USD", "GBP", "EUR", "CAD", "AUD", "NGN"];

export type RatesState = { status: "idle" | "loading" | "ready" | "error"; rates: Rates | null };

let ratesRequest: Promise<Rates> | null = null;

/** Exchange rates, fetched once and only when a fee range is in use. */
export function useRates(wanted: boolean): RatesState {
  const [result, setResult] = useState<{ rates: Rates | null } | null>(null);

  useEffect(() => {
    if (!wanted || result) return;
    let live = true;
    ratesRequest ??= fetch("/api/rates")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("rates"))))
      .then((body: { rates: Rates }) => body.rates);
    ratesRequest.then(
      (rates) => live && setResult({ rates }),
      () => {
        ratesRequest = null; // a reload can try again
        if (live) setResult({ rates: null });
      },
    );
    return () => {
      live = false;
    };
  }, [wanted, result]);

  if (result) return { status: result.rates ? "ready" : "error", rates: result.rates };
  return { status: wanted ? "loading" : "idle", rates: null };
}

type Props = {
  schools: SavedSchool[];
  filters: Filters;
  onChange: (next: Filters) => void;
  /** The currency the range is read in when none has been picked. */
  currency: string;
  shown: number;
  unknownFee: number;
  rates: RatesState;
};

function Chips<T extends string>({
  options,
  value,
  onPick,
  label,
}: {
  options: Option<T>[];
  value: T | null;
  onPick: (value: T | null) => void;
  label: (option: Option<T>) => string;
}) {
  return (
    <div className={styles.chips}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={styles.chip}
          aria-pressed={value === o.value}
          data-active={value === o.value || undefined}
          onClick={() => onPick(value === o.value ? null : o.value)}
        >
          {label(o)}
          <span className={styles.chipCount}>{o.count}</span>
        </button>
      ))}
    </div>
  );
}

export function SchoolFilters({ schools, filters, onChange, currency, shown, unknownFee, rates }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { levels, starts, stages, withScholarships, currencies } = facets(schools);
  const active = activeCount(filters);
  const narrowed = shown < schools.length;
  const currencyOptions = [...new Set([...currencies.map((c) => c.value), ...COMMON_CURRENCIES])];

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const setFee = (patch: Partial<Filters["fee"]>) => set({ fee: { ...filters.fee, ...patch } });

  return (
    <div className={styles.filters}>
      <div className={styles.bar}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search by school, course, city or note"
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
          aria-label="Search saved schools"
        />
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={panelId}
          data-active={active > 0 || undefined}
          onClick={() => setOpen((v) => !v)}
        >
          Filters
          {active > 0 && <span className={styles.badge}>{active}</span>}
        </button>
      </div>

      <div className={styles.panel} id={panelId} hidden={!open}>
        <section className={styles.group}>
          <h3 className="eyebrow">Scholarships</h3>
          <div className={styles.chips}>
            <button
              type="button"
              className={styles.chip}
              aria-pressed={filters.scholarships}
              data-active={filters.scholarships || undefined}
              onClick={() => set({ scholarships: !filters.scholarships })}
            >
              Has a scholarship
              <span className={styles.chipCount}>{withScholarships}</span>
            </button>
          </div>
        </section>

        <section className={styles.group}>
          <h3 className="eyebrow">Classes start</h3>
          {starts.length > 0 ? (
            <Chips options={starts} value={filters.starts} onPick={(v) => set({ starts: v })} label={(o) => o.label} />
          ) : (
            <p className={styles.hint}>No start dates saved yet. Schools you add from now on will have them.</p>
          )}
        </section>

        <section className={styles.group}>
          <h3 className="eyebrow">Tuition per year</h3>
          <div className={styles.range}>
            <input
              className={styles.amount}
              inputMode="numeric"
              placeholder="Min"
              aria-label="Minimum tuition per year"
              value={filters.fee.min}
              onChange={(e) => setFee({ min: e.target.value })}
            />
            <span className={styles.dash} aria-hidden="true">–</span>
            <input
              className={styles.amount}
              inputMode="numeric"
              placeholder="Max"
              aria-label="Maximum tuition per year"
              value={filters.fee.max}
              onChange={(e) => setFee({ max: e.target.value })}
            />
            <select
              className={styles.currency}
              aria-label="Currency"
              value={currency}
              onChange={(e) => setFee({ currency: e.target.value })}
            >
              {currencyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <p className={styles.hint}>
            {rates.status === "error"
              ? `Exchange rates couldn't be loaded, so only fees already in ${currency} can be compared.`
              : rates.status === "loading"
                ? "Loading today's exchange rates…"
                : "Uses the international rate where a school lists more than one. Other currencies are converted at today's rate, so treat edges as approximate."}
          </p>
        </section>

        {levels.length > 1 && (
          <section className={styles.group}>
            <h3 className="eyebrow">Level</h3>
            <Chips options={levels} value={filters.level} onPick={(v) => set({ level: v })} label={(o) => o.label} />
          </section>
        )}

        {stages.length > 1 && (
          <section className={styles.group}>
            <h3 className="eyebrow">Stage</h3>
            <Chips
              options={stages}
              value={filters.stage}
              onPick={(v) => set({ stage: v })}
              label={(o) => STATUS_LABELS[o.value]}
            />
          </section>
        )}
      </div>

      {(narrowed || active > 0 || filters.query) && (
        <p className={styles.summary}>
          <span>
            Showing <strong>{shown}</strong> of {schools.length}
          </span>
          {unknownFee > 0 && (
            <span className={styles.unknown}>
              {unknownFee} hidden because {unknownFee === 1 ? "its" : "their"} tuition couldn&rsquo;t be compared ·{" "}
              <button type="button" className={styles.link} onClick={() => set({ includeUnknownFee: true })}>
                show {unknownFee === 1 ? "it" : "them"}
              </button>
            </span>
          )}
          <button
            type="button"
            className={styles.link}
            onClick={() => onChange({ ...NO_FILTERS, fee: { ...NO_FILTERS.fee, currency: filters.fee.currency } })}
          >
            Clear all
          </button>
        </p>
      )}
    </div>
  );
}
