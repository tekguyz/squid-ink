"use client";

import { useCallback, useEffect, useState } from "react";
import type { RecorderPhase } from "@/lib/recorder/recorder-store";

/** The HUD's destructive controls (#20). Each asks for a second press. */
export type ArmedControl = "stop" | "discard" | "dismiss";

/**
 * Two-step confirmation for the HUD, in the shape collection-manage.tsx's
 * Delete already uses: the first press arms the control and its label says
 * so, the second press acts. No native confirm() — it blocks the tab and
 * cannot be styled.
 *
 * At most one control is armed. It disarms on Escape, on blur (the caller
 * wires `disarm` to onBlur), on any other HUD action (the caller calls
 * `disarm` first), and on any phase change — so a Stop armed while
 * recording is not still armed after a pause and resume. The reset runs
 * during render (React's "adjusting state when a prop changes" pattern), so
 * no frame ever shows a stale armed label.
 */
export function useArmed(phase: RecorderPhase) {
  const [armed, setArmed] = useState<ArmedControl | null>(null);
  const [armedPhase, setArmedPhase] = useState(phase);
  if (armedPhase !== phase) {
    setArmedPhase(phase);
    setArmed(null);
  }

  const disarm = useCallback(() => setArmed(null), []);

  useEffect(() => {
    if (!armed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setArmed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  /** The click handler for a two-step control: arm, then act. */
  const press = useCallback(
    (control: ArmedControl, act: () => void) => () => {
      if (armed !== control) {
        setArmed(control);
        return;
      }
      setArmed(null);
      act();
    },
    [armed],
  );

  return { armed, press, disarm };
}
