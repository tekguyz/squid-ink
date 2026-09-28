import type { Ref } from "react";
import { ArmedLabel } from "@/components/recorder/armed-label";
import { GHOST_ACTION, PILL } from "@/components/recorder/hud-styles";

/**
 * The HUD's error state. Moved out of record-hud.tsx (#20).
 *
 * `audioKept` says whether a recording exists on this device (the store holds
 * a note id). A prompt refused before recording began left no audio, so the
 * pill neither claims one is kept nor asks twice before Dismiss (#20).
 *
 * There is no retry affordance, deliberately: the requirement is that a failed
 * upload be VISIBLE, not recoverable in one click, and useRecorder exposes no
 * retry to wire a button to.
 */
export function HudErrorPill({
  message,
  audioKept,
  armed,
  onDismiss,
  onBlur,
  dismissRef,
}: {
  message: string | null;
  audioKept: boolean;
  /** Dismiss has had its first press and waits for the second. */
  armed: boolean;
  onDismiss(): void;
  onBlur(): void;
  dismissRef: Ref<HTMLButtonElement>;
}) {
  return (
    <div
      role="alert"
      className={`${PILL} bg-pane border-rule-2 max-w-sm items-start gap-[11px] border px-[13px] py-[9px]`}
    >
      <span aria-hidden="true" className="bg-live mt-[4px] h-[9px] w-[9px] shrink-0" />
      <span className="font-body text-ink-2 text-[12px] leading-[1.5]">
        {message}
        {/* Not reassurance — a fact. The blob is written to IndexedDB before
            the upload is attempted, so it really is still here. */}
        {audioKept ? (
          <span className="text-meta block">
            {armed
              ? "Dismiss deletes it from this device."
              : "The recording is kept on this device."}
          </span>
        ) : null}
      </span>
      <button
        ref={dismissRef}
        type="button"
        onClick={onDismiss}
        onBlur={onBlur}
        className={`${GHOST_ACTION} shrink-0`}
      >
        <ArmedLabel armed={armed} idle="Dismiss" confirm="Confirm dismiss" />
      </button>
    </div>
  );
}
