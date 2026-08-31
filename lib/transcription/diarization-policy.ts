/** Whether a recording gets diarized, and whether it gets transcribed at all.
 *
 *  A pure function of duration, deliberately. Diarization is a processing
 *  OUTCOME, not a user setting — notes.diarization_enabled has no UI toggle
 *  and must not grow one.
 *
 *  Both ceilings are Gemini's, not ours, and were read from
 *  ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe on 2026-08-31:
 *  one hour per request, dropping to thirty minutes the moment speaker
 *  diarization or word-level timestamps is enabled. We ask for both together,
 *  so the diarized path lives under the thirty-minute cap.
 *
 *  28 minutes rather than 30 is a deliberate safety margin. Our duration is the
 *  recorder's elapsed clock, which is not the decoded length of the container
 *  Gemini receives; a container that reports a little long would otherwise be
 *  rejected at the cap with nothing to show for the call. */

/** Diarize at or below this. 28 min, two minutes under Gemini's 30-min
 *  diarized cap. */
export const DIARIZATION_MAX_SECONDS = 28 * 60;

/** Gemini's plain-transcription cap. Past this we do not call at all. */
export const PLAIN_MAX_SECONDS = 60 * 60;

export type TranscriptionPlan =
  | { kind: "diarized" }
  | { kind: "plain"; reason: string }
  | { kind: "too-long"; reason: string };

export function planFor(durationSeconds: number | null): TranscriptionPlan {
  // Unknown, zero and negative all mean "the recorder did not tell us". Plain
  // is the safe answer: it succeeds for anything up to an hour, whereas a
  // wrongly-optimistic diarized call hard-fails at thirty minutes and we have
  // spent the upload for nothing. A degraded success beats a confident failure.
  if (durationSeconds === null || durationSeconds <= 0) {
    return {
      kind: "plain",
      reason: "duration unknown, defaulting to plain transcription",
    };
  }

  if (durationSeconds <= DIARIZATION_MAX_SECONDS) return { kind: "diarized" };

  if (durationSeconds <= PLAIN_MAX_SECONDS) {
    return {
      kind: "plain",
      reason:
        `${durationSeconds}s exceeds the ${DIARIZATION_MAX_SECONDS}s ` +
        `diarization threshold`,
    };
  }

  // No segmentation and no stitching. ROADMAP defers both explicitly at
  // single-owner scale, so the honest outcome is a clear failure with a log
  // line naming the reason — not a silently truncated transcript.
  return {
    kind: "too-long",
    reason:
      `${durationSeconds}s exceeds Gemini's ${PLAIN_MAX_SECONDS}s cap; ` +
      `segmentation is not implemented`,
  };
}
