"use client";

import { useSyncExternalStore } from "react";

/**
 * The app's one theme mechanism.
 *
 * This file used to hold a fixed corner button, ThemeToggle, mounted on Note
 * Detail and added only so both token sets could be checked without changing
 * the OS setting. It was REMOVED on 2026-09-13: Settings → Appearance
 * (components/settings/appearance-section.tsx) does the same job, and the
 * corner it claimed is free again. The filename stays because CLAUDE.md and
 * docs/KNOWN_GAPS.md cite it in the history of the corner-collision defect.
 *
 * What remains is the store both used: the class on <html>, which is what the
 * stylesheet paints from, plus localStorage, which the boot script in
 * components/theme-boot.tsx reads on the next load.
 */

export type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** THE one write path for the theme. Anything that changes the theme calls
 *  this, so there is no second mechanism to drift. */
export function applyTheme(next: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(next);
  try {
    localStorage.setItem("theme", next);
  } catch {
    // Storage can be unavailable (private mode). The class still applies.
  }
}

/** The <html> class IS the store. Observing it, rather than holding a copy in
 *  React state, means no control can disagree with what is actually painted. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/** The current theme and the setter. The server snapshot is "light"; hydration
 *  then re-reads the real class — a one-frame correction on a dark machine. */
export function useTheme(): [Theme, (next: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as const);
  return [theme, applyTheme];
}
