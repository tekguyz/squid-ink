import { planFor } from "@/lib/transcription/diarization-policy";
import { persistTranscription } from "@/lib/transcription/persist-result";
import type { SweepPorts, UploadingRow } from "@/lib/transcription/sweep";

/** ONE note, from 'uploading' to a terminal state. Both triggers call this:
 *  the daily cron sweep in sweep.ts, and the user-pressed Transcribe action in
 *  app/notes/actions/transcription.ts.
 *
 *  It lived inside the sweep's loop until 2026-09-01. It moved out for the
 *  reason the sweep's own comments give for not adding a queue table: two
 *  copies of the claim would be two sources of truth that can disagree, and
 *  the disagreement would cost a Gemini call.
 *
 *  What is NOT here, deliberately: age. Staleness is a sweep-only concern — it
 *  exists so an unattended reconciliation does not false-fail a slow-but-real
 *  upload. A user pressing a button has already decided the note is ready. The
 *  sweep expresses its threshold by passing failOnMissingObject, so the
 *  branching below stays identical for both callers. */

export type ClaimOutcome =
  /** This caller's UPDATE was the one that matched. It now owns the row. */
  | "claimed"
  /** The guarded UPDATE matched zero rows: somebody else moved the row first,
   *  or it was never 'uploading'. NOT an error — and never a Gemini call. */
  | "contended"
  /** No object yet, and the caller said that is not terminal. Look again later. */
  | "waiting"
  /** No object, and the caller said that IS terminal. The row is now 'failed'. */
  | "no-object";

export interface ClaimOptions {
  /** What an absent Storage object means to this caller. The sweep passes its
   *  staleness verdict; the manual trigger always passes true. */
  failOnMissingObject: boolean;
  /** Log colour only — how old the row was when the caller looked. The manual
   *  trigger does not measure age and passes nothing. */
  ageMs?: number | null;
}

/** Everything the claim needs, and nothing it does not. Narrower than
 *  SweepPorts so a caller cannot accidentally reach the transcriber from here. */
export type ClaimPorts = Pick<SweepPorts, "claim" | "objectExists" | "log">;

/** The transcribing half. Only ever called on a row this process just claimed. */
export type TranscribePorts = Pick<
  SweepPorts,
  "log" | "downloadAudio" | "transcribe" | "store"
>;

export async function claimNoteForTranscription(
  ports: ClaimPorts,
  row: UploadingRow,
  options: ClaimOptions,
): Promise<ClaimOutcome> {
  // Existence FIRST, and with list() — a claim to 'analyzing' on a row whose
  // audio never landed would burn the download and the Gemini call before
  // discovering there is nothing to send.
  const exists = row.audio_storage_path
    ? await ports.objectExists(row.audio_storage_path)
    : false;

  if (!exists) {
    if (!options.failOnMissingObject) {
      // A slow-but-real upload. Say nothing, do nothing, look again next tick.
      return "waiting";
    }

    if (!(await ports.claim(row.id, "uploading", "failed"))) return "contended";

    const age =
      typeof options.ageMs === "number"
        ? ` after ${Math.round(options.ageMs / 60000)} min`
        : "";

    ports.log(
      `note ${row.id}: no object at ${row.audio_storage_path ?? "(no path)"}` +
        `${age}. The upload never landed. Marked 'failed'.`,
    );
    return "no-object";
  }

  // THE claim, through the one implementation in supabase-ports.ts.
  return (await ports.claim(row.id, "uploading", "analyzing"))
    ? "claimed"
    : "contended";
}

export async function transcribeClaimedNote(
  ports: TranscribePorts,
  row: UploadingRow,
): Promise<"transcribed" | "failed"> {
  const plan = planFor(row.audio_duration_seconds);

  if (plan.kind === "too-long") {
    ports.log(`note ${row.id}: ${plan.reason}. Marked 'failed'.`);
    await ports.store.markFailed(row.id, plan.reason);
    return "failed";
  }

  if (plan.kind === "plain") ports.log(`note ${row.id}: ${plan.reason}`);

  try {
    // download() ONLY here, and only to move bytes to Gemini. Existence was
    // already proved with list() in the claim — a CDN-cached read must never be
    // the thing that decides whether an object is there.
    const { blob, mimeType } = await ports.downloadAudio(
      row.audio_storage_path!,
    );

    const result = await ports.transcribe({
      audio: blob,
      mimeType,
      diarize: plan.kind === "diarized",
    });

    await persistTranscription({
      store: ports.store,
      noteId: row.id,
      userId: row.user_id,
      result,
    });

    ports.log(
      `note ${row.id}: transcribed, ${result.segments.length} segment(s), ` +
        `diarized=${result.diarized}.`,
    );
    return "transcribed";
  } catch (error) {
    // No error-message column at single-owner scale. The Vercel function log is
    // where a failure is read.
    const reason = error instanceof Error ? error.message : String(error);
    ports.log(`note ${row.id}: transcription failed — ${reason}`);
    await ports.store.markFailed(row.id, reason);
    return "failed";
  }
}

/** The whole unit in one call, for callers with nothing useful to do between
 *  claiming and finishing.
 *
 *  Neither shipped caller is one. The sweep takes the two steps separately
 *  because its per-run cap counts rows that reached Gemini, and a cheap orphan
 *  failure must not hold a slot; the Server Action takes them separately
 *  because it answers the browser the moment the claim settles and finishes the
 *  rest in `after()`. scripts/verify-manual-transcribe.mjs is the caller — it
 *  wants the composed path end to end, which is exactly what it is proving. */
export async function claimAndTranscribe(
  ports: ClaimPorts & TranscribePorts,
  row: UploadingRow,
  options: ClaimOptions,
): Promise<ClaimOutcome | "transcribed" | "failed"> {
  const outcome = await claimNoteForTranscription(ports, row, options);
  if (outcome !== "claimed") return outcome;
  return transcribeClaimedNote(ports, row);
}
