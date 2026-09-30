"use client";

import { useEffect, useRef, useState } from "react";
import { isPipelineDone } from "@/lib/notes/notegen-progress";
import { readNoteProgress } from "@/lib/notes/transcription-status";

/**
 * Watches one note until transcription AND note generation are terminal, and
 * refreshes the server-rendered page when they are. Generation runs seconds
 * after transcription finishes (issue #79), so 'completed' alone is not done.
 *
 * It lived inside transcribe-button.tsx until 2026-09-01. It moved because it
 * is a behaviour, not a piece of that button: its own interval, its own time
 * cap, its own reason for not clearing on the first terminal reading. A caller
 * that has decided a note is worth watching is all it needs, which is why the
 * whole interface is one boolean.
 *
 * NOT a subscription. Realtime stays deferred (docs/ROADMAP.md); this is a
 * bounded poll of ONE row on the page the reader is looking at.
 */

/** Five seconds is slower than a transcription ever finishes in and fast enough
 *  that the reader does not wonder whether it hung. */
export const POLL_INTERVAL_MS = 5_000;

/** Ten minutes, comfortably past the 300 s function ceiling both paths run
 *  under, so the cap is a backstop for a lost transcription rather than a
 *  second, shorter deadline competing with the real one. */
export const POLL_LIMIT_MS = 10 * 60 * 1000;

/**
 * @param noteId the note to watch.
 * @param active whether to be watching at all. Flipping it false stops the
 *   poll; unmounting does too.
 * @param onSettled called when transcription finishes (once, so the transcript
 *   shows early), then on every tick once generation is terminal too.
 * @returns `gaveUp`, true once the time cap has passed with no terminal
 *   reading. The caller owns what to say about that — this hook has no opinion
 *   on copy.
 */
export function useTranscriptionPoll(
  noteId: string,
  active: boolean,
  onSettled: () => void,
): { gaveUp: boolean } {
  const [gaveUp, setGaveUp] = useState(false);

  // onSettled through a ref, so the effect does NOT depend on its identity.
  // MEASURED: without this, a caller whose callback is rebuilt each render
  // restarts the interval on every render — including the one caused by
  // setGaveUp below, which resurrects the poll the cap had just stopped. The
  // caller cannot reasonably be asked to guarantee a stable callback; useRouter
  // alone returns a fresh object each render under @testing-library.
  const settled = useRef(onSettled);
  settled.current = onSettled;

  // The interval's whole lifetime is this effect. It is cleared on unmount and
  // at the time cap — navigating away from the note leaves nothing running.
  //
  // Date.now() is read here, in an effect, never in a render path: CLAUDE.md
  // bans the latter because it makes a render non-deterministic, and neither
  // reason applies to a side effect measuring its own elapsed time.
  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const startedAt = Date.now();
    let transcriptShown = false;

    const timer = setInterval(() => {
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        clearInterval(timer);
        if (!cancelled) setGaveUp(true);
        return;
      }

      void readNoteProgress(noteId)
        .then((next) => {
          if (cancelled || next === null) return;
          if (next.processing !== "completed" && next.processing !== "failed") {
            return;
          }

          // After a 'completed' transcription the note is done only once
          // generation is terminal — null means "not started yet".
          if (!isPipelineDone(next.processing, next.notegen)) {
            // Show the transcript now, once; keep polling for the rest.
            if (!transcriptShown) {
              transcriptShown = true;
              settled.current();
            }
            return;
          }

          // DELIBERATELY NOT clearInterval HERE. Clearing on the first
          // terminal reading left a dead poll whenever the caller's refresh
          // came back still saying 'uploading' — this effect's dependencies
          // had not changed, so nothing restarted it, and the button sat on
          // "Transcribing…" for the rest of the session. The poll's real stop
          // condition is `active` going false, which is what a refresh
          // carrying the terminal status causes. Until that happens, asking
          // again is the correct behaviour, and POLL_LIMIT_MS still bounds it.
          settled.current();
        })
        .catch((error: unknown) => {
          // A broken poll must not read as "still working". Log it and let the
          // tick cap end the wait with the caller's neutral message.
          console.error("Could not read the transcription status:", error);
        });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, noteId]);

  return { gaveUp };
}
