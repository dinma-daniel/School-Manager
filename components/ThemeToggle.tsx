"use client";

import { useSyncExternalStore } from "react";
import styles from "./ThemeToggle.module.css";

type Theme = "light" | "dark";

/**
 * The theme lives on the <html> element, set before first paint by the inline
 * script in the layout. React reads it from there rather than keeping a second
 * copy that could disagree with what's on screen.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

// Nothing is rendered on the server that depends on the real value, so light
// is a safe placeholder — useSyncExternalStore re-reads once hydrated.
const getServerTheme = (): Theme => "light";

function setTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("uniapp-theme", theme);
  } catch {
    // Preference just won't stick; the toggle still works this session.
  }
  listeners.forEach((notify) => notify());
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
    >
      <span className={styles.mark} aria-hidden="true" />
      {next === "dark" ? "Dark" : "Light"}
    </button>
  );
}
