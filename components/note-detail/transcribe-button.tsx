"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  triggerTranscription,
  type TranscriptionTrigger,
} from "@/app/notes/actions/transcription";
import { readProcessingStatus } from "@/lib/notes/transcription-status";
import type { ProcessingStatus } from "@/lib/notes/view-types";

/**
 * The on-demand transcription trigger — the option docs/KNOWN_GAPS.md left open
 * as "a deliberate Transcribe action the user presses", and the one the owner
 * chose over transcribing automatically when a recording stops.
 *
 * ELIGIBILITY IS A RENDER CONDITION, NOT A DISABLED STATE. Outside 'uploading'
 * and 'analyzing' there is no button in the DOM at all: nothing to focus,
 * nothing for a screen reader to reach, nothing to re-enable from the console.
 * That matters most for 'failed', which is TERMINAL by design — a retry
 * affordance is exactly what this build decided not to have, and an element
 * that merely looks unavailable is one CSS change away from being one.
 * 'local' is excluded too: no upload has started, so there is no object and the
 * claim would only ever match zero rows.
 *
 * 'failed' still SAYS so, in prose with no control attached. "No retry" was the
 * decision; "no status" was not, and a control silently ceasing to exist is not
 * how the outcome of a press gets reported. 'completed' and 'local' render
 * nothing — the transcript itself is the report for one, and the other is a
 * state no shipped write path produces.
 *
 * 'analyzing' polls on MOUNT, with no click. The cron sweep or another tab may
 * have claimed the row, and the reader should see that rather than a button
 * that would lose the race.
 */

/** Five seconds is slower than a transcription ever finishes in and fast enough
 *  that the reader does not wonder whether it hung. */
export const POLL_INTERVAL_MS = 5_000;

/** Ten minutes, comfortably past the 300 s function ceiling both paths run
 *  under. Past it the poll stops and says so. This is a client-side courtesy:
 *  the sweep's own staleness handling is what actually reconciles a
 *  transcription that died, an hour later.
 *
 *  MEASURED AGAINST THE CLOCK, not by counting ticks. Chrome throttles
 *  setInterval in a backgrounded tab to roughly once a minute, so 120 ticks is
 *  ten minutes only in a foreground tab and could stretch past an hour in a
 *  background one — the cap would have quietly meant something different
 *  depending on whether the reader was looking at it. */
export const POLL_LIMIT_MS = 10 * 60 * 1000;

/** The recorder HUD's action-button voice, matching audio-player.tsx on the
 *  same meta line: 9px mono, uppercase, square border, zero radius.
 *
 *  `bg-raised`, NOT `bg-canvas`. MEASURED 2026-09-01: in dark theme
 *  `--canvas` and `--paper` resolve to the same oklch, so the button's computed
 *  background was identical to the sheet behind it and its only boundary was
 *  `border-rule-2` at 1.47:1 — under WCAG 1.4.11's 3:1 for the boundary of a
 *  control. `raised` is also what DESIGN.md § Components → Buttons already
 *  gives the quick-action button, so this is returning to the documented token
 *  rather than inventing one. audio-player.tsx sits on the same meta line and
 *  moved to `bg-raised` in the same pass — the two constants are identical by
 *  intent and must stay so.
 *
 *  The BORDER is knowingly left at `border-rule-2`, measuring 1.40:1 light /
 *  1.47:1 dark against the sheet. See docs/KNOWN_GAPS.md § "Framed controls
 *  sit at ~1.4:1" — an app-wide token decision, not a defect in this button.
 *
 *  No `disabled:` variants. The element is never natively disabled — see
 *  aria-disabled below — so the unavailable state is styled through
 *  `aria-disabled:`. `text-muted` rather than `text-meta`: meta measured
 *  4.37:1 on dark paper, under the 4.5:1 the 9px type needs. */
const BUTTON =
  "font-mono text-[9px] tracking-[0.06em] uppercase " +
  "flex items-center gap-[7px] border border-rule-2 bg-raised text-notice " +
  "px-[9px] py-[5px] transition-colors cursor-pointer " +
  "hover:border-tint-hover hover:bg-tint hover:text-accent-text " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent " +
  "aria-disabled:cursor-default aria-disabled:text-muted " +
  "aria-disabled:hover:border-rule-2 aria-disabled:hover:bg-raised " +
  "aria-disabled:hover:text-muted";

const ROW = "flex flex-wrap items-center gap-[11px] px-[26px] pt-[3px] pb-[15px]";

/** PROSE, not a slug. DESIGN.md's Slug Rule governs labels; these are
 *  sentences, and 9px uppercase at 0.14em is the least readable setting in the
 *  system to have been carrying the only text that explains a failure. This is
 *  the notice-block treatment DESIGN.md § Components → Cards already specifies:
 *  "`notice-bg` fill, `notice` text at 11.5px, 9px × 7px" — copied to the
 *  character from transcript-pane.tsx:38, which is the existing instance.
 *  (detect.mjs flags 11.5px as off the type ramp; DESIGN.md line 471 is the
 *  ramp entry it does not know about, so that advisory is a false positive.) */
const NOTICE =
  "bg-notice-bg px-[9px] py-[7px] text-[11.5px] leading-[1.5] text-notice";

/** Every outcome the action can report other than "started". Each is a fact
 *  about someone else's action, never an invitation to press again. Full
 *  sentences, full stops — they are read, not scanned. */
const OUTCOME_NOTICE: Record<Exclude<TranscriptionTrigger, "started">, string> = {
  "not-claimed": "Already being transcribed.",
  "no-audio": "The recording never finished uploading.",
  "not-found": "This note is no longer available.",
};

export function TranscribeButton({
  noteId,
  status,
}: {
  noteId: string;
  status: ProcessingStatus;
}) {
  const router = useRouter();
  const [requested, setRequested] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const eligible = status === "uploading" || status === "analyzing";
  const working = eligible && (status === "analyzing" || requested);
  const polling = working && !gaveUp;

  // The interval's whole lifetime is this effect. It is cleared on unmount and
  // at the time cap — navigating away from the note leaves nothing running.
  //
  // Date.now() is read here, in an effect, never in a render path: CLAUDE.md
  // bans the latter because it makes a render non-deterministic, and neither
  // reason applies to a side effect measuring its own elapsed time.
  useEffect(() => {
    if (!polling) return;

    let cancelled = false;
    const startedAt = Date.now();

    const timer = setInterval(() => {
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        clearInterval(timer);
        if (!cancelled) setGaveUp(true);
        return;
      }

      void readProcessingStatus(noteId)
        .then((next) => {
          if (cancelled || next === null) return;
          if (next !== "completed" && next !== "failed") return;

          // The transcript pane is a Server Component reading through
          // lib/notes/get-note.ts. Refresh it rather than building a second,
          // client-side path to the same rows.
          //
          // DELIBERATELY NOT clearInterval HERE. Clearing on the first
          // terminal reading left a dead poll whenever the refresh came back
          // still saying 'uploading' — the effect's dependencies had not
          // changed, so nothing restarted it, and the button sat on
          // "Transcribing…" for the rest of the session. The poll's real stop
          // condition is this component unmounting, which is exactly what a
          // refresh carrying the terminal status causes: `eligible` goes
          // false, the component returns null, and the cleanup below runs.
          // Until that happens, asking again is the correct behaviour, and
          // POLL_LIMIT_MS still bounds it.
          router.refresh();
        })
        .catch((error: unknown) => {
          // A broken poll must not read as "still working". Log it and let the
          // tick cap end the wait with its neutral message.
          console.error("Could not read the transcription status:", error);
        });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [polling, noteId, router]);

  const start = useCallback(() => {
    // aria-disabled does not stop a click the way the native attribute does,
    // so the guard has to live here. Harmless either way — the server's claim
    // is atomic and a stray press returns "not-claimed" — but a second
    // in-flight request would still be a wasted round trip.
    if (working || pending) return;

    setNotice(null);
    setRequested(true);

    startTransition(async () => {
      let outcome: TranscriptionTrigger;
      try {
        outcome = await triggerTranscription(noteId);
      } catch (error) {
        console.error("Could not start transcription:", error);
        setRequested(false);
        setNotice("Could not start. Try again.");
        return;
      }

      // "started" means this caller won the claim — keep the poll running.
      if (outcome === "started") return;

      setRequested(false);
      setNotice(OUTCOME_NOTICE[outcome]);
      // Whatever happened, the server's idea of this note has moved.
      router.refresh();
    });
  }, [noteId, router, working, pending]);

  // A terminal 'failed' note used to render NOTHING here, so the outcome of a
  // user-pressed action was communicated by a control quietly ceasing to
  // exist — on a page otherwise identical to the one before the press. The
  // decision this component enforces is "no RETRY affordance"; it never
  // authorised "no status either". So: a statement and a next step, in prose,
  // with no control attached. The button stays absent.
  if (status === "failed") {
    return (
      <div className={ROW}>
        <p className={NOTICE}>
          This recording could not be transcribed. Record again to try.
        </p>
      </div>
    );
  }

  if (!eligible) return null;

  const message = gaveUp
    ? "Still working. Refresh to check."
    : notice;

  return (
    <div className={ROW}>
      <button
        type="button"
        className={BUTTON}
        // aria-disabled, NOT the native attribute. `disabled` removes the
        // element from the accessibility tree AND from the tab order, so the
        // label flipping to "Transcribing…" — the only feedback a press
        // produces — was announced to nobody, and a keyboard user lost focus
        // mid-interaction. This keeps it focusable and announceable; `start`
        // guards the press instead.
        aria-disabled={working || pending}
        onClick={start}
      >
        {/* The same 9px filled square the recorder HUD and the audio player
            use. Hollow while working, matching the player's pause glyph. */}
        <span
          aria-hidden
          className={`h-[9px] w-[9px] ${working ? "border border-current" : "bg-current"}`}
        />
        {working ? "Transcribing…" : "Transcribe"}
      </button>

      {/* Rendered unconditionally and filled later. A role="status" element
          that appears at the same instant as its text is not reliably
          announced — the region has to already be in the accessibility tree
          for the change to register as one. Empty, it is invisible and takes
          no space; the gave-up message shares it rather than replacing the
          button, so focus is never dropped. */}
      <span role="status" className={message ? NOTICE : "sr-only"}>
        {message}
      </span>
    </div>
  );
}
