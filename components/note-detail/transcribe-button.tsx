"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  triggerTranscription,
  type TranscriptionTrigger,
} from "@/app/notes/actions";
import { readProcessingStatus } from "@/lib/notes/transcription-status";
import type { ProcessingStatus } from "@/lib/notes/view-types";

/**
 * The on-demand transcription trigger — the option docs/KNOWN_GAPS.md left open
 * as "a deliberate Transcribe action the user presses", and the one the owner
 * chose over transcribing automatically when a recording stops.
 *
 * ELIGIBILITY IS A RENDER CONDITION, NOT A DISABLED STATE. For a 'completed' or
 * 'failed' note this component returns null: there is no element, nothing to
 * focus, nothing for a screen reader to read out and nothing to enable from the
 * console. That matters most for 'failed', which is TERMINAL by design — a
 * retry affordance is exactly the thing this build decided not to have, and an
 * element that merely looks unavailable is one CSS change away from being one.
 * 'local' is excluded too: no upload has started, so there is no object and the
 * claim would only ever match zero rows.
 *
 * 'analyzing' polls on MOUNT, with no click. The cron sweep or another tab may
 * have claimed the row, and the reader should see that rather than a button
 * that would lose the race.
 */

/** Five seconds is slower than a transcription ever finishes in and fast enough
 *  that the reader does not wonder whether it hung. */
export const POLL_INTERVAL_MS = 5_000;

/** 120 ticks — ten minutes, comfortably past the 300 s function ceiling both
 *  paths run under. Past it the poll stops and says so. This is a client-side
 *  courtesy: the sweep's own staleness handling is what actually reconciles a
 *  transcription that died, an hour later. */
export const POLL_TICK_LIMIT = 120;

/** The recorder HUD's action-button voice, matching audio-player.tsx on the
 *  same meta line: 9px mono, uppercase, square border, zero radius. */
const BUTTON =
  "font-mono text-[9px] tracking-[0.06em] uppercase cursor-pointer " +
  "flex items-center gap-[7px] border border-rule-2 bg-canvas text-notice " +
  "px-[9px] py-[5px] transition-colors " +
  "hover:border-tint-hover hover:bg-tint hover:text-accent-text " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent " +
  "disabled:cursor-default disabled:text-meta disabled:hover:border-rule-2 " +
  "disabled:hover:bg-canvas disabled:hover:text-meta";

const ROW = "flex items-center gap-[11px] px-[26px] pt-[3px] pb-[15px]";

const NOTICE =
  "font-mono text-[9px] tracking-[0.14em] uppercase text-meta";

const STANDALONE_NOTICE = `${ROW} ${NOTICE}`;

/** Every outcome the action can report other than "started". Each is a fact
 *  about someone else's action, never an invitation to press again. */
const OUTCOME_NOTICE: Record<Exclude<TranscriptionTrigger, "started">, string> = {
  "not-claimed": "Already being transcribed",
  "no-audio": "The recording never finished uploading",
  "not-found": "This note is no longer available",
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

  // The interval's whole lifetime is this effect. It is cleared on unmount, on
  // reaching a terminal state, and at the tick cap — navigating away from the
  // note leaves nothing running.
  useEffect(() => {
    if (!polling) return;

    let cancelled = false;
    let ticks = 0;

    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > POLL_TICK_LIMIT) {
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
          // POLL_TICK_LIMIT still bounds it.
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
  }, [noteId, router]);

  if (!eligible) return null;

  if (gaveUp) {
    return <p className={STANDALONE_NOTICE}>Still working — refresh to check</p>;
  }

  return (
    <div className={ROW}>
      <button
        type="button"
        className={BUTTON}
        disabled={working || pending}
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

      {notice ? <span className={NOTICE}>{notice}</span> : null}
    </div>
  );
}
