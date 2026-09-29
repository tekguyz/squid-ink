"use client";

import { useEffect, useRef } from "react";
import type { RecorderPhase } from "@/lib/recorder/recorder-store";

/**
 * Where keyboard focus goes as the HUD changes phase (#20, #24), so it is
 * never dropped on the page body when the control it was on unmounts.
 *
 * - Closing the choice, or dismissing an error, hands focus back to Record.
 *   So does Saved closing, when focus is still the HUD's (below).
 * - A failed START moves it to the error's first control: the user just
 *   pressed a choice.
 * - A failed SAVE moves it to Retry, and a finished one to "Open note", only
 *   when focus is still the HUD's: inside it, or dropped on the body because
 *   the button it was on (Stop, Retry) unmounted. A save ends seconds after
 *   the press, and must not pull focus from whatever the user is doing by
 *   then.
 *
 * The HUD attaches the refs to its root, Record, Retry, Dismiss and
 * "Open note".
 */
export function useHudFocus(phase: RecorderPhase) {
  const root = useRef<HTMLDivElement>(null);
  const recordButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const dismissButton = useRef<HTMLButtonElement>(null);
  const openNoteLink = useRef<HTMLAnchorElement>(null);
  const previousPhase = useRef(phase);

  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = phase;
    // First mount is not a phase change: focus stays where the page put it.
    if (previous === phase) return;
    const active = document.activeElement;
    const focusIsOurs =
      !active || active === document.body || Boolean(root.current?.contains(active));

    if (phase === "idle" && (previous === "choosing" || previous === "error")) {
      recordButton.current?.focus();
    }
    if (phase === "idle" && previous === "saved" && focusIsOurs) recordButton.current?.focus();
    if (phase === "error") {
      // `choosing` too: React batches a start that fails at once into one render.
      const startFailed = previous === "requesting" || previous === "choosing";
      if (startFailed || focusIsOurs) (retryButton.current ?? dismissButton.current)?.focus();
    }
    if (phase === "saved" && focusIsOurs) openNoteLink.current?.focus();
  }, [phase]);

  return { root, recordButton, retryButton, dismissButton, openNoteLink };
}
