import { PILL } from "@/components/recorder/hud-styles";
import { WAITING_PROMPT, type RecordingMode } from "@/lib/recorder/recording-mode";

/**
 * The two pills that wait on something outside the HUD (#24). Neither holds a
 * control: nothing in the HUD can close the browser's own prompt, and a save
 * in flight has no step the user can act on.
 */

/** The browser's prompt is open. Says what it needs, per mode. The marker is
 *  a hollow accent square — hollow like paused, but in accent, not `faint`. */
export function HudWaitingPill({ mode }: { mode: RecordingMode }) {
  return (
    <div
      role="status"
      className={`${PILL} bg-pane border-rule gap-[11px] border px-[13px] py-[9px]`}
    >
      <span aria-hidden="true" className="border-accent h-[9px] w-[9px] border-[1.5px]" />
      <span className="font-body text-ink-2 text-[12px]">{WAITING_PROMPT[mode]}</span>
    </div>
  );
}

/** `stopping` and `uploading` are one "Saving" here, with the recording's
 *  length frozen beside it. Both phases render this same element with the
 *  same words, so a screen reader hears "Saving" once. */
export function HudSavingPill({ elapsed }: { elapsed: string }) {
  return (
    <div
      role="status"
      className={`${PILL} bg-pane border-rule gap-[11px] border px-[13px] py-[9px]`}
    >
      {/* A slow pulse says the save is working, not hung. It stops under
          reduced motion, and the words carry the state without it. */}
      <span aria-hidden="true" className="bg-accent h-[9px] w-[9px] motion-safe:animate-pulse" />
      <span className="font-mono text-notice text-[9.5px] tracking-[0.1em] uppercase">
        Saving
      </span>
      <span className="font-mono text-muted text-[12px] tabular-nums">{elapsed}</span>
    </div>
  );
}
