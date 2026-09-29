"use client";

import { useEffect } from "react";
import { HudLevelBars } from "@/components/recorder/hud-level-bars";
import { HudDemoRecord } from "@/components/recorder/hud-demo-record";
import { HudErrorPill } from "@/components/recorder/hud-error-pill";
import { HudModeChoice } from "@/components/recorder/hud-mode-choice";
import {
  HudSavingPill,
  HudWaitingPill,
} from "@/components/recorder/hud-progress-pills";
import { HudSavedPill } from "@/components/recorder/hud-saved-pill";
import {
  FOCUS_RING,
  GHOST_ACTION,
  MONO_ACTION,
  PILL,
} from "@/components/recorder/hud-styles";
import { useHudFocus } from "@/components/recorder/use-hud-focus";
import { ArmedLabel } from "@/components/recorder/armed-label";
import { useArmed } from "@/components/recorder/use-armed";
import { HUD_SAFE_MARGIN } from "@/components/recorder/hud-safe-margin";
import { formatElapsed } from "@/lib/recorder/format-elapsed";
import { isAtRest, useRecorderStore } from "@/lib/recorder/recorder-store";
import { RECORDING_ANNOUNCEMENT } from "@/lib/recorder/recording-mode";
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
 *
 * #24 designed the states 02b left out: the waiting pill says what the
 * browser's prompt needs, `stopping` and `uploading` show as one "Saving",
 * a `saved` pill links to the new note, and the error pill speaks a plain
 * sentence per cause, with Retry when the audio is kept
 * (hud-progress-pills.tsx, hud-saved-pill.tsx, hud-error-pill.tsx).
 *
 * #20 added the Meeting / Mic only choice (hud-mode-choice.tsx) and made
 * Stop, Discard and the error pill's Dismiss two-step (use-armed.ts): the
 * first press arms and relabels the control ("Confirm stop"), the second acts.
 * Each sits inside a live region (the status or alert pill), so the new label
 * is announced.
 *
 * ⌘⇧R IS wired. The design renders the shortcut as a promise, and a label for a
 * key that does nothing is a lie in the UI.
 */
/** `demo`: a demo visitor (issue #19) sees Record turned off, with the reason.
 *  Hidden would say the app does not record; the database refuses the upload
 *  either way. */
export function RecordHud({
  controls,
  demo = false,
}: {
  controls: RecorderControls;
  demo?: boolean;
}) {
  const phase = useRecorderStore((s) => s.phase);
  const elapsedMs = useRecorderStore((s) => s.elapsedMs);
  const level = useRecorderStore((s) => s.level);
  const errorCause = useRecorderStore((s) => s.errorCause);
  const mode = useRecorderStore((s) => s.mode);
  const notice = useRecorderStore((s) => s.notice);
  const noteId = useRecorderStore((s) => s.noteId);
  const micLost = useRecorderStore((s) => s.micLost);
  const closeChoice = useRecorderStore((s) => s.closeChoice);
  const closeSaved = useRecorderStore((s) => s.closeSaved);
  const { armed, press, disarm } = useArmed(phase);
  const focus = useHudFocus(phase);

  useEffect(() => {
    if (demo) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "r") return;
      const current = useRecorderStore.getState().phase;
      // Not from `error`: its pill asks for Retry or Dismiss first.
      if (current === "error" || (!isAtRest(current) && current !== "choosing"))
        return;
      // Ctrl+Shift+R is also the browser's hard reload. Claimed while the
      // choice is open too, so a second press does not reload the page.
      // From Saved it starts a new recording, as from idle (#24).
      event.preventDefault();
      if (current !== "choosing") void controls.start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls, demo]);

  const elapsed = formatElapsed(elapsedMs);

  return (
    <div
      ref={focus.root}
      // The corner this HUD owns. The inset is the shared safe margin, not a
      // spacing step chosen here — see hud-safe-margin.ts.
      style={{ right: HUD_SAFE_MARGIN, bottom: HUD_SAFE_MARGIN }}
      className="pointer-events-none fixed z-50 flex flex-col items-end gap-[9px]"
    >
      {phase === "idle" && demo ? <HudDemoRecord /> : null}

      {phase === "idle" && !demo ? (
        <button
          ref={focus.recordButton}
          type="button"
          onClick={() => void controls.start()}
          className={`${PILL} bg-pane border-control-edge group gap-[11px] border px-[13px] py-[9px] ${FOCUS_RING}`}
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

      {phase === "choosing" ? (
        <HudModeChoice
          notice={notice}
          onChoose={(chosen) => void controls.choose(chosen)}
          onCancel={closeChoice}
        />
      ) : null}

      {phase === "requesting" ? <HudWaitingPill mode={mode ?? "mic"} /> : null}

      {phase === "recording" ? (
        <>
          <div
            role="status"
            className={`${PILL} bg-pane border-rule-2 gap-[13px] border py-[9px] pr-[11px] pl-[13px]`}
          >
            <span
              aria-hidden="true"
              className="bg-live h-[9px] w-[9px] rounded-full"
            />
            <span className="sr-only">
              {RECORDING_ANNOUNCEMENT[mode ?? "mic"]}
            </span>
            <span className="font-mono text-ink text-[16px] font-medium tracking-[-0.01em]">
              {elapsed}
            </span>
            <HudLevelBars level={level} />
            <span aria-hidden="true" className="bg-rule h-[20px] w-px" />
            <button
              type="button"
              onClick={() => {
                disarm();
                controls.pause();
              }}
              className={`${MONO_ACTION} border-control-edge text-notice border px-[8px] py-[5px]`}
            >
              Pause
            </button>
            <button
              type="button"
              onClick={press("stop", () => void controls.stop())}
              onBlur={disarm}
              className={`${MONO_ACTION} ${armed === "stop" ? "bg-accent-pressed" : "bg-accent"} text-on-accent px-[9px] py-[5px] font-medium`}
            >
              <ArmedLabel
                armed={armed === "stop"}
                idle="Stop"
                confirm="Confirm stop"
              />
            </button>
          </div>
          <p className="font-mono text-faint text-[9px] tracking-[0.04em]">
            DRAG ANYWHERE · SNAPS TO THE NEAREST CORNER · NEVER OVER A SHARED
            SCREEN
          </p>
        </>
      ) : null}

      {phase === "paused" ? (
        <div
          role="status"
          className={`${PILL} bg-paper border-rule-3 gap-[13px] border py-[9px] pr-[11px] pl-[13px]`}
        >
          <span
            aria-hidden="true"
            className="border-faint h-[9px] w-[9px] border-[1.5px]"
          />
          <span className="font-mono text-muted text-[16px] font-medium tracking-[-0.01em]">
            {elapsed}
          </span>
          <span className="font-mono text-meta-4 text-[9px] tracking-[0.1em] uppercase">
            Paused
          </span>
          <span aria-hidden="true" className="bg-rule-3 h-[20px] w-px" />
          <button
            type="button"
            onClick={() => {
              disarm();
              controls.resume();
            }}
            className={`${MONO_ACTION} border-accent text-accent-text border px-[9px] py-[5px]`}
          >
            Resume
          </button>
          <button
            type="button"
            onClick={press("discard", () => void controls.discard())}
            onBlur={disarm}
            className={GHOST_ACTION}
          >
            <ArmedLabel
              armed={armed === "discard"}
              idle="Discard"
              confirm="Confirm discard"
            />
          </button>
        </div>
      ) : null}

      {phase === "stopping" || phase === "uploading" ? (
        <HudSavingPill elapsed={elapsed} />
      ) : null}

      {phase === "saved" && noteId ? (
        <HudSavedPill
          noteId={noteId}
          micLost={micLost}
          onClose={closeSaved}
          openNoteRef={focus.openNoteLink}
        />
      ) : null}

      {phase === "error" && errorCause ? (
        <HudErrorPill
          cause={errorCause}
          armed={armed === "dismiss"}
          onRetry={() => {
            disarm();
            void controls.retry();
          }}
          // Two-step only when it would delete the only copy of the audio.
          onDismiss={
            errorCause === "save-failed"
              ? press("dismiss", () => void controls.discard())
              : () => void controls.discard()
          }
          onBlur={disarm}
          retryRef={focus.retryButton}
          dismissRef={focus.dismissButton}
        />
      ) : null}
    </div>
  );
}
