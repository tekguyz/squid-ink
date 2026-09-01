"use client";

import { useState, useTransition } from "react";
import { transcribeNote } from "@/app/notes/actions";
import type { ProcessingStatus } from "@/lib/notes/types";

/**
 * The user-pressed transcription trigger, resolving docs/KNOWN_GAPS.md § "The
 * cron sweep is the ONLY transcription trigger". Before this, a recording
 * reached Gemini only when the daily Vercel Hobby cron ran.
 *
 * Deliberately NOT auto-firing on mount. That would be the per-note-route
 * option KNOWN_GAPS lists beside this one, and the owner has said immediate
 * transcription is not required — an effect that spends a Gemini call every
 * time a page is opened is the expensive way to get there by accident.
 *
 * NO POLLING and no timer. The server action's own response is the completion
 * signal; `revalidatePath` inside it re-renders the pane with the transcript.
 * `useTransition` is what makes that honest — isPending stays true through the
 * revalidated re-render, not just until the promise settles, so the button is
 * not briefly idle over stale content.
 *
 * THE BUSY STATE IS LOAD-BEARING, not decoration. A 25-minute recording can
 * hold this open for most of the 300 s Vercel function ceiling. A button that
 * merely greys out reads as hung, so the label changes and a live region says
 * what the wait is for.
 */

/** Two states are eligible and three are not. 'uploading' is a note the sweep
 *  has not reached; 'failed' is a retry. 'analyzing' already has a live
 *  transcription behind it, 'completed' has a transcript, and 'local' never
 *  uploaded — offering any of them an action would be a lie about what would
 *  happen. */
const ELIGIBLE: readonly ProcessingStatus[] = ["uploading", "failed"];

/** The recorder HUD's and the audio player's action-button voice, reused
 *  rather than reinvented: 9px mono, uppercase, 0.06em, square border. ZERO
 *  RADIUS — DESIGN.md's hardest rule. */
const BUTTON =
  "font-mono text-[9px] tracking-[0.06em] uppercase cursor-pointer " +
  "inline-flex items-center gap-[7px] border border-rule-2 bg-canvas text-notice " +
  "px-[9px] py-[5px] transition-colors " +
  "hover:border-tint-hover hover:bg-tint hover:text-accent-text " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent " +
  "disabled:cursor-wait disabled:border-rule disabled:text-meta-2 " +
  "disabled:hover:bg-canvas disabled:hover:text-meta-2";

/** DESIGN.md's Notice block, and the One Ink Rule is the reason it is not a
 *  red: there is no destructive hue in this system, and `notice` on
 *  `notice-bg` IS the warning treatment. `notice-bg` fill, `notice` text at
 *  11.5px, 9px x 7px padding, no border, square. */
const NOTICE =
  "mt-[9px] bg-notice-bg px-[9px] py-[7px] font-body text-[11.5px] " +
  "leading-[1.5] text-notice";

/** The in-flight hint is NOT a notice. It reports normal progress, and giving
 *  it the warning treatment would spend the one alarm this palette has on the
 *  case where nothing is wrong. Quiet meta prose instead. */
const WORKING = "mt-[9px] font-body text-[11.5px] leading-[1.5] text-meta";

export interface TranscribeButtonProps {
  noteId: string;
  status: ProcessingStatus;
}

export function TranscribeButton({ noteId, status }: TranscribeButtonProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (!ELIGIBLE.includes(status)) return null;

  function run() {
    // Cleared on press, not on settle: leaving the previous failure on screen
    // while a new attempt runs would report the wrong thing about the attempt
    // the user is currently watching.
    setMessage(null);

    startTransition(async () => {
      try {
        const result = await transcribeNote(noteId);

        // Zero rows matched is not an error here, exactly as it is not one in
        // sweep.ts or markUploadFailed — the cron simply claimed the row first.
        if (result.status === "not-eligible") {
          setMessage(
            "This note was already transcribed, or a transcription is already running.",
          );
        } else if (result.status === "failed") {
          // There is no error-message column at single-owner scale, so this
          // cannot say why. It says where to look instead.
          setMessage(
            "This note could not be transcribed. The reason is in the server log.",
          );
        }
        // 'transcribed' says nothing: the revalidated transcript IS the message.
      } catch (error) {
        // Never leave the button stuck disabled on a thrown action. The user
        // must be able to press it again.
        setMessage(error instanceof Error ? error.message : String(error));
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        aria-busy={pending}
        className={BUTTON}
      >
        {pending ? "Transcribing…" : "Transcribe now"}
      </button>

      {/* ONE region, present before it has anything to say. A live region
          mounted at the same moment as its text is announced unreliably, and
          swapping between two of them is the same bug wearing a second node.
          Only the treatment changes with the state. */}
      <p
        role="status"
        aria-live="polite"
        className={pending || !message ? WORKING : NOTICE}
      >
        {pending
          ? "Working. This can take a few minutes for a long recording — leave the page open."
          : message}
      </p>
    </div>
  );
}
