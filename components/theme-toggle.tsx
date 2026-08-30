"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/** Not in the design file. Added so both token sets can be checked without
 *  changing the OS setting. Follows prefers-color-scheme until first use. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    setTheme(root.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage can be unavailable (private mode). The class still applies.
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="fixed right-3 bottom-3 z-10 cursor-pointer border border-rule bg-raised px-2.5 py-1.5 font-mono text-[9px] tracking-[0.14em] uppercase text-meta hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
