"use client";

import { useEffect } from "react";
import { HudLevelBars } from "@/components/recorder/hud-level-bars";
import { HUD_SAFE_MARGIN } from "@/components/recorder/hud-safe-margin";
import { formatElapsed } from "@/lib/recorder/format-elapsed";
import { useRecorderStore } from "@/lib/recorder/recorder-store";
import type { RecorderControls } from "@/lib/recorder/use-recorder";

/**
 * The record HUD, App Surfaces surface 02b.
 *
 * Locked design, implemented not invented: layout, states and copy are taken
 * from the design file. Every colour is a token — `bg-live` and `--shadow-hud`
 * were added to app/globals.css in this track because 02b uses a red and a
 * shadow that had no token yet. The recording state reads entirely from
 * `--live`, dot and level meter alike; see hud-level-bars.tsx for why the
 * design's greens did not survive there.
 *
 * Not built here, deliberately (docs/KNOWN_GAPS.md):
 *   - 02b's expanded jot pane. It renders "rough notes", and no column or table
 *     exists for them — notes.raw_transcript is the transcript, not the user's
 *     notes. Building the UI without a home for its data would be guessing at a
 *     schema decision this track does not own.
 *   - Drag and snap-to-corner. The caption is rendered because it is the
 *     design's copy; the dock itself is fixed bottom-right.
 *   - OPEN FULL PANE (surface 02) and CHANGE PERSONA. Both outside the fence.
 *   - Any retry affordance on the error state. The requirement is that a failed
 *     upload be VISIBLE, not recoverable in one click, and useRecorder exposes
 *     no retry to wire a button to.
 *
 * ⌘⇧R IS wired. The design renders the shortcut as a promise, and a label for a
 * key that does nothing is a lie in the UI.
 */
const PILL =
  "pointer-events-auto flex items-center shadow-[0_8px_24px_var(--shadow-hud)]";
const MONO_ACTION =
  "font-mono text-[9px] tracking-[0.06em] uppercase cursor-pointer";

export function RecordHud({ controls }: { controls: RecorderControls }) {
  const phase = useRecorderStore((s) => s.phase);
  const elapsedMs = useRecorderStore((s) => s.elapsedMs);
  const level = useRecorderStore((s) => s.level);
  const errorMessage = useRecorderStore((s) => s.errorMessage);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "r") return;
      if (useRecorderStore.getState().phase !== "idle") return;
      event.preventDefault();
      void controls.start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls]);

  const elapsed = formatElapsed(elapsedMs);

  return (
    <div
      // The corner this HUD owns. The inset is the shared safe margin, not a
      // spacing step chosen here — see hud-safe-margin.ts.
      style={{ right: HUD_SAFE_MARGIN, bottom: HUD_SAFE_MARGIN }}
      className="pointer-events-none fixed z-50 flex flex-col items-end gap-[9px]"
    >
      {phase === "idle" ? (
        <button
          type="button"
          onClick={() => void controls.start()}
          className={`${PILL} bg-pane border-rule group gap-[11px] border px-[13px] py-[9px]`}
        >
          <span aria-hidden="true" className="bg-accent h-[9px] w-[9px]" />
          <span className="font-header text-ink text-[13.5px] font-semibold">
            Record
          </span>
          {/* The shortcut is a reminder, not part of the control's identity.
              `hidden` rather than a faded span: an invisible flex child still
              claims its gap, and the defect being fixed is the resting width.
              ⌘⇧R stays wired either way — the key works whether or not the
              label is on screen. */}
          <span className="font-mono text-meta-4 hidden pl-[2px] text-[9.5px] group-hover:inline group-focus-visible:inline">
            ⌘⇧R
          </span>
        </button>
      ) : null}

      {phase === "requesting" ? (
        <div
          role="status"
          className={`${PILL} bg-pane border-rule gap-[11px] border px-[13px] py-[9px]`}
        >
          <span className="font-mono text-meta-4 text-[9.5px] tracking-[0.1em] uppercase">
            Waiting for permission
          </span>
        </div>
      ) : null}

      {phase === "recording" ? (
        <>
          <div
            role="status"
            className={`${PILL} bg-pane border-rule-2 gap-[13px] border py-[9px] pr-[11px] pl-[13px]`}
          >
            <span aria-hidden="true" className="bg-live h-[9px] w-[9px] rounded-full" />
            <span className="sr-only">Recording system audio and microphone</span>
            <span className="font-mono text-ink text-[16px] font-medium tracking-[-0.01em]">
              {elapsed}
            </span>
            <HudLevelBars level={level} />
            <span aria-hidden="true" className="bg-rule h-[20px] w-px" />
            <button
              type="button"
              onClick={controls.pause}
              className={`${MONO_ACTION} border-rule-2 text-notice border px-[8px] py-[5px]`}
            >
              Pause
            </button>
            <button
              type="button"
              onClick={() => void controls.stop()}
              className={`${MONO_ACTION} bg-accent text-on-accent px-[9px] py-[5px] font-medium`}
            >
              Stop
            </button>
          </div>
          <p className="font-mono text-faint text-[9px] tracking-[0.04em]">
            DRAG ANYWHERE · SNAPS TO THE NEAREST CORNER · NEVER OVER A SHARED SCREEN
          </p>
        </>
      ) : null}

      {phase === "paused" ? (
        <div
          role="status"
          className={`${PILL} bg-paper border-rule-3 gap-[13px] border py-[9px] pr-[11px] pl-[13px]`}
        >
          <span aria-hidden="true" className="border-faint h-[9px] w-[9px] border-[1.5px]" />
          <span className="font-mono text-muted text-[16px] font-medium tracking-[-0.01em]">
            {elapsed}
          </span>
          <span className="font-mono text-meta-4 text-[9px] tracking-[0.1em] uppercase">
            Paused
          </span>
          <span aria-hidden="true" className="bg-rule-3 h-[20px] w-px" />
          <button
            type="button"
            onClick={controls.resume}
            className={`${MONO_ACTION} border-tint-hover text-accent-text border px-[9px] py-[5px]`}
          >
            Resume
          </button>
          <button
            type="button"
            onClick={() => void controls.discard()}
            className={`${MONO_ACTION} text-rail-idle px-[8px] py-[5px]`}
          >
            Discard
          </button>
        </div>
      ) : null}

      {phase === "stopping" || phase === "uploading" ? (
        <div
          role="status"
          className={`${PILL} bg-pane border-rule gap-[11px] border px-[13px] py-[9px]`}
        >
          <span aria-hidden="true" className="bg-accent h-[9px] w-[9px]" />
          <span className="font-mono text-notice text-[9.5px] tracking-[0.1em] uppercase">
            {phase === "stopping" ? "Finishing" : "Uploading"}
          </span>
        </div>
      ) : null}

      {phase === "error" ? (
        <div
          role="alert"
          className={`${PILL} bg-pane border-rule-2 max-w-sm items-start gap-[11px] border px-[13px] py-[9px]`}
        >
          <span aria-hidden="true" className="bg-live mt-[4px] h-[9px] w-[9px] shrink-0" />
          <span className="font-body text-ink-2 text-[12px] leading-[1.5]">
            {errorMessage}
            {/* Not reassurance — a fact. The blob is written to IndexedDB
                before the upload is attempted, so it really is still here. */}
            <span className="text-meta block">The recording is kept on this device.</span>
          </span>
          <button
            type="button"
            onClick={() => void controls.discard()}
            className={`${MONO_ACTION} text-rail-idle shrink-0 px-[8px] py-[5px]`}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
