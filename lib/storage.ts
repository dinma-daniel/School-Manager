"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { SavedSchool } from "./schema";

const KEY = "uniapp-schools";
const EMPTY: SavedSchool[] = [];

/**
 * The saved list lives in localStorage, and React reads it from there rather
 * than keeping a second copy in state. Two consequences worth having: another
 * tab's changes show up here, and there's only ever one source of truth.
 */

const listeners = new Set<() => void>();

/** Used only if localStorage refuses writes — a private window, or full. */
let memoryFallback: SavedSchool[] | null = null;

// useSyncExternalStore re-renders until getSnapshot returns a stable value, so
// the parsed array is cached and only rebuilt when the stored text changes.
let cachedRaw: string | null = null;
let cachedValue: SavedSchool[] = EMPTY;

function parse(raw: string | null): SavedSchool[] {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedSchool[]) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function getSnapshot(): SavedSchool[] {
  if (memoryFallback) return memoryFallback;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

// Nothing on the server knows what's in the browser; `useHydrated` below is
// what stops the empty state flashing before the real list arrives.
const getServerSnapshot = (): SavedSchool[] => EMPTY;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange); // another tab edited the list
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function write(next: SavedSchool[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    memoryFallback = null;
  } catch {
    // Keep working for this session even though it won't survive a reload.
    memoryFallback = next;
  }
  listeners.forEach((notify) => notify());
}

const noopSubscribe = () => () => {};

/** False during SSR and the hydration render, true once we're on the client. */
function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function useSchools() {
  const schools = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const ready = useHydrated();

  const add = useCallback(
    (school: SavedSchool) => write([school, ...getSnapshot().filter((s) => s.id !== school.id)]),
    [],
  );

  const update = useCallback(
    (id: string, patch: Partial<SavedSchool>) =>
      write(getSnapshot().map((s) => (s.id === id ? { ...s, ...patch } : s))),
    [],
  );

  const remove = useCallback((id: string) => write(getSnapshot().filter((s) => s.id !== id)), []);

  /**
   * Swap a saved course for another, keeping the stage and note the old one
   * has *now* — the user may have changed them while the new one was read.
   * If the old one has gone meanwhile, the new one is simply added.
   */
  const replace = useCallback((oldId: string, school: SavedSchool) => {
    const current = getSnapshot();
    const old = current.find((s) => s.id === oldId);
    const next = old ? { ...school, status: old.status, note: old.note } : school;
    write([next, ...current.filter((s) => s.id !== oldId && s.id !== school.id)]);
  }, []);

  return { schools, ready, add, update, remove, replace };
}
