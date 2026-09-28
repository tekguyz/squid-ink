"use client";

import { useEffect, useRef } from "react";
import type { RecorderPhase } from "@/lib/recorder/recorder-store";

/**
 * Where keyboard focus goes as the HUD changes phase (#20), so it is never
 * dropped on the page body when the control it was on unmounts.
 *
 * - Closing the choice, or dismissing an error, hands focus back to Record.
 * - A failed START moves it to the error's Dismiss: the user just pressed a
 *   choice. An upload that fails later does not — it must not pull focus from
 *   whatever the user is doing by then.
 *
 * The HUD attaches the two refs to its Record and Dismiss buttons.
 */
export function useHudFocus(phase: RecorderPhase) {
  const recordButton = useRef<HTMLButtonElement>(null);
  const dismissButton = useRef<HTMLButtonElement>(null);
  const previousPhase = useRef(phase);

  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = phase;
    if (phase === "idle" && (previous === "choosing" || previous === "error")) {
      recordButton.current?.focus();
    }
    // `choosing` too: React batches a start that fails at once into one render.
    if (phase === "error" && (previous === "requesting" || previous === "choosing")) {
      dismissButton.current?.focus();
    }
  }, [phase]);

  return { recordButton, dismissButton };
}
