"use client";

import { useSyncExternalStore } from "react";
import { HUD_SAFE_MARGIN } from "@/components/recorder/hud-safe-margin";

export type Theme = "light" | "dark";

/** The vertical space this toggle claims in the bottom-left corner: its own
 *  box plus the shared safe margin above and below it.
 *
 *  Exported because the persona rail's footer ends in the same corner, and the
 *  lesson of the HUD collision is that a corner has to be reserved somewhere
 *  rather than assumed free. The rail reads this; nothing restates it. */
export const THEME_TOGGLE_LANE = `calc(28px + ${HUD_SAFE_MARGIN} * 2)`;

function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** THE one write path for the theme. The class on <html> is what paints, and
 *  localStorage is what the boot script in app/layout.tsx reads on the next
 *  load. Everything that changes the theme calls this — the corner toggle and
 *  /settings' Appearance cards — so there is no second mechanism to drift. */
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
 *  React state, is what makes two controls on one page unable to disagree:
 *  both read the attribute the stylesheet reads. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/** The current theme and the setter, for any control that shows or changes it.
 *  The server snapshot is "light"; hydration then re-reads the real class, the
 *  same one-frame correction the toggle has always made. */
export function useTheme(): [Theme, (next: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as const);
  return [theme, applyTheme];
}

/** Not in the design file. Added so both token sets can be checked without
 *  changing the OS setting. The theme itself is applied before paint by the
 *  boot script in app/layout.tsx; this only reads and flips it. */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      suppressHydrationWarning
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      // Bottom-LEFT, and the inset comes from the Record HUD's own constant.
      // The HUD owns bottom-right; this used to sit in the same corner and the
      // two overlapped by coincidence of render order.
      style={{ left: HUD_SAFE_MARGIN, bottom: HUD_SAFE_MARGIN }}
      className="fixed z-10 cursor-pointer border border-control-edge bg-raised px-2.5 py-1.5 font-mono text-[9px] tracking-[0.14em] uppercase text-meta hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
