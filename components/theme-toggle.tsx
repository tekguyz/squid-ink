"use client";

import { useEffect, useState } from "react";
import { HUD_SAFE_MARGIN } from "@/components/recorder/hud-safe-margin";

type Theme = "light" | "dark";

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

/** Not in the design file. Added so both token sets can be checked without
 *  changing the OS setting. The theme itself is applied before paint by the
 *  boot script in app/layout.tsx; this only reads and flips it. */
export function ThemeToggle() {
  // Server renders "light"; the effect corrects it on mount. suppressHydration-
  // Warning covers the one-frame difference on a dark-preferring machine.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => setTheme(currentTheme()), []);

  const toggle = () =>
    setTheme((previous) => {
      const next: Theme = previous === "dark" ? "light" : "dark";
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(next);
      try {
        localStorage.setItem("theme", next);
      } catch {
        // Storage can be unavailable (private mode). The class still applies.
      }
      return next;
    });

  return (
    <button
      type="button"
      onClick={toggle}
      suppressHydrationWarning
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      // Bottom-LEFT, and the inset comes from the Record HUD's own constant.
      // The HUD owns bottom-right; this used to sit in the same corner and the
      // two overlapped by coincidence of render order.
      style={{ left: HUD_SAFE_MARGIN, bottom: HUD_SAFE_MARGIN }}
      className="fixed z-10 cursor-pointer border border-rule bg-raised px-2.5 py-1.5 font-mono text-[9px] tracking-[0.14em] uppercase text-meta hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
