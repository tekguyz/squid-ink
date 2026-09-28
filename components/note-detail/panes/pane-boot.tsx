"use client";

/**
 * Puts each pane's saved hidden-or-shown choice on `<html>` before first
 * paint (issue #23), so a hidden pane never flashes open and closes. The same
 * pattern, and the same reasons for the inert client copy, as
 * `components/theme-boot.tsx` — read that header first.
 *
 * No layout effect here, unlike the theme: a pane only exists on a note, and
 * the note shell re-applies the saved choice itself on every note
 * (`applySavedPanes` in `pane-state.ts`).
 */

// Serialised into the script below, so it must stay self-contained ES5. The
// keys and attribute names are the contract `pane-state.ts` writes; rename
// them in both files or neither.
function applySavedPanes() {
  var d = document.documentElement;
  var panes = ["lens", "transcript"];
  for (var i = 0; i < panes.length; i++) {
    try {
      if (localStorage.getItem("pane:" + panes[i]) === "hidden")
        d.setAttribute("data-pane-" + panes[i], "hidden");
    } catch (e) {}
  }
}

const BOOT_SCRIPT = `(${applySavedPanes.toString()})()`;

export function PaneBoot() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }}
    />
  );
}
