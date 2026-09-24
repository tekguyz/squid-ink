"use client";

import { useLayoutEffect } from "react";

/**
 * Sets the theme class on <html> before first paint, from the choice saved by
 * applyTheme (components/theme-toggle.tsx), else the OS setting.
 *
 * The browser runs this script while it parses the server HTML, before React
 * loads — that is what stops a light flash on a dark machine. React warns
 * whenever a CLIENT render produces a <script>, because such a script never
 * runs; a notFound() client-renders the root layout, so a plain inline script
 * there logged "Encountered a script tag" (GitHub issue #1). This is the fix
 * from Next's "Preventing flash before hydration" guide: the type is
 * JavaScript on the server and inert text on the client, and
 * suppressHydrationWarning accepts the mismatch. It must be a client
 * component — in a server component `typeof window` is evaluated only on the
 * server, and the client would still receive text/javascript.
 *
 * That same client render resets <html> to its JSX className, dropping the
 * class the script set, so a saved choice that differs from the OS setting was
 * lost on the 404. The layout effect re-applies it before paint. It is a no-op
 * on a normal load, where the class is already there.
 */

// Serialised into the script below, so it must stay self-contained ES5: no
// imports, no closures, nothing the browser cannot parse before React loads.
function applySavedTheme() {
  try {
    var t = localStorage.getItem("theme");
    var d = document.documentElement;
    if (t === "dark") d.classList.add("dark");
    else if (t === "light") d.classList.add("light");
    else if (matchMedia("(prefers-color-scheme:dark)").matches) d.classList.add("dark");
  } catch (e) {}
}

const BOOT = `(${applySavedTheme.toString()})()`;

export function ThemeBoot() {
  useLayoutEffect(applySavedTheme, []);
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: BOOT }}
    />
  );
}
