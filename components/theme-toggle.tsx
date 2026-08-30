"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

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
      className="fixed right-3 bottom-3 z-10 cursor-pointer border border-rule bg-raised px-2.5 py-1.5 font-mono text-[9px] tracking-[0.14em] uppercase text-meta hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
