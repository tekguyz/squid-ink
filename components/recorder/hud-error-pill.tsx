import type { Ref } from "react";
import { ArmedLabel } from "@/components/recorder/armed-label";
import { GHOST_ACTION, MONO_ACTION, PILL } from "@/components/recorder/hud-styles";
import { HUD_SAFE_MARGIN } from "@/components/recorder/hud-safe-margin";
import type { RecorderErrorCause } from "@/lib/recorder/recorder-store";
import { MIC_REFUSED } from "@/lib/recorder/recording-mode";

/** Plain words for each cause (#24). Never raw browser or server text — the
 *  raw error is logged to the console where it was caught. */
const ERROR_COPY: Record<RecorderErrorCause, string> = {
  "mic-refused": MIC_REFUSED,
  unsupported: "This browser cannot record audio.",
  "save-failed": "Could not save the recording.",
  "start-failed": "Could not start recording. Try again.",
};

/**
 * The HUD's error state. Moved out of record-hud.tsx (#20).
 *
 * Only a failed save has audio behind it (#24): the device backup is written
 * before any save can fail. So only that cause says the recording is kept,
 * offers Retry, and asks twice before Dismiss deletes it. Every other cause
 * failed before any audio existed, and says nothing is kept by saying nothing.
 *
 * Retry is one press: it deletes nothing, so it asks for no confirmation.
 */
export function HudErrorPill({
  cause,
  armed,
  onRetry,
  onDismiss,
  onBlur,
  retryRef,
  dismissRef,
}: {
  cause: RecorderErrorCause;
  /** Dismiss has had its first press and waits for the second. */
  armed: boolean;
  onRetry(): void;
  onDismiss(): void;
  onBlur(): void;
  retryRef: Ref<HTMLButtonElement>;
  dismissRef: Ref<HTMLButtonElement>;
}) {
  const audioKept = cause === "save-failed";
  return (
    <div
      role="alert"
      // Wide enough that most copy takes two lines, never closer than the safe
      // margin to the left edge on a phone. An error pill may overhang the
      // HUD_RESERVE strip (hud-safe-margin.ts says why); the tight padding
      // and leading keep the overhang small.
      style={{ maxWidth: `min(28rem, calc(100vw - 2 * ${HUD_SAFE_MARGIN}))` }}
      className={`${PILL} bg-pane border-rule-2 items-center gap-[11px] border px-[13px] py-[6px]`}
    >
      <span aria-hidden="true" className="bg-live h-[9px] w-[9px] shrink-0 self-start mt-[4px]" />
      <span className="font-body text-ink-2 text-[12px] leading-[1.35]">
        {ERROR_COPY[cause]}
        {audioKept ? (
          <span className="text-meta block">
            {armed ? "A second press deletes it." : "It is kept on this device."}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-[4px]">
        {audioKept ? (
          <button
            ref={retryRef}
            type="button"
            onClick={onRetry}
            className={`${MONO_ACTION} border-accent text-accent-text border px-[9px] py-[5px]`}
          >
            Retry
          </button>
        ) : null}
        <button
          ref={dismissRef}
          type="button"
          onClick={onDismiss}
          onBlur={onBlur}
          className={GHOST_ACTION}
        >
          <ArmedLabel armed={armed} idle="Dismiss" confirm="Confirm dismiss" />
        </button>
      </span>
    </div>
  );
}
