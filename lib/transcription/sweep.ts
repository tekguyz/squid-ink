import type { TranscriptionStore } from "@/lib/transcription/persist-result";
import {
  claimNoteForTranscription,
  transcribeClaimedNote,
} from "@/lib/transcription/transcribe-note";
import type { Transcriber } from "@/lib/transcription/transcript";

/** All the branching, and none of the I/O.
 *
 *  processing_status IS the queue. There is no job table: a row's own status
 *  says whether it is waiting, in flight, done or dead, and the transitions are
 *  the only coordination. Adding a queue table would mean two sources of truth
 *  that can disagree.
 *
 *  Every side effect is an injected port, which is what lets the whole state
 *  machine — claim races, staleness, caps — be tested with no database and no
 *  network. */

/** A row is stale after an hour. The threshold exists ONLY to avoid
 *  false-failing a slow-but-real upload; the actual safety check is whether the
 *  object exists. An old row with audio behind it is transcribed, not failed. */
export const STALE_AFTER_MS = 60 * 60 * 1000;

/** Vercel Hobby caps a function at 300 s and offers no extension (measured
 *  2026-08-31). Three transcriptions is what fits with room for a slow one. */
export const MAX_TRANSCRIPTIONS_PER_RUN = 3;

/** Reconciliation is a status flip and no Gemini call — cheap enough to clear
 *  a backlog in one tick. */
export const MAX_RECONCILIATIONS_PER_RUN = 25;

/** Stop claiming NEW work past this. Under the 300 s ceiling with enough left
 *  to finish and return rather than being killed mid-write. */
export const RUN_BUDGET_MS = 240_000;

export interface UploadingRow {
  id: string;
  user_id: string;
  audio_storage_path: string | null;
  audio_duration_seconds: number | null;
  updated_at: string;
}

export interface SweepPorts {
  now(): number;
  log(message: string): void;
  listUploading(limit: number): Promise<UploadingRow[]>;
  /** Rows still 'analyzing' whose updated_at is older than `cutoffIso`. */
  listStaleAnalyzing(cutoffIso: string, limit: number): Promise<string[]>;
  /** The atomic claim: a single UPDATE ... WHERE processing_status = expected.
   *  True only if this caller's update was the one that matched. */
  claim(noteId: string, expected: string, next: string): Promise<boolean>;
  /** list()/metadata, NEVER download(). Storage reads are CDN-cached. */
  objectExists(path: string): Promise<boolean>;
  downloadAudio(path: string): Promise<{ blob: Blob; mimeType: string }>;
  transcribe: Transcriber;
  store: TranscriptionStore;
}

/** The only observability this pipeline has — there is no error column, and
 *  the Vercel function log is where a run is read. So the counters have to
 *  distinguish causes, not just tally rows: a backlog the cap pushed aside and
 *  a handful of uploads still in flight are very different situations, and a
 *  single `skipped` number made them look identical. */
export interface SweepReport {
  transcribed: number;
  failed: number;
  reconciled: number;
  /** Pushed to the next tick by the per-run cap or the wall-clock budget. */
  deferred: number;
  /** Object has not appeared yet, still inside the staleness threshold.
   *  The healthy, boring case — not a backlog. */
  waiting: number;
  /** An overlapping invocation claimed the row first. Not an error. */
  contended: number;
}

export async function sweep(ports: SweepPorts): Promise<SweepReport> {
  const startedAt = ports.now();
  const report: SweepReport = {
    transcribed: 0,
    failed: 0,
    reconciled: 0,
    deferred: 0,
    waiting: 0,
    contended: 0,
  };

  /** Transcription ATTEMPTS, which is what the cap must bound.
   *
   *  Counting successes instead left the cap inoperative in exactly the case
   *  it was sized for: a failing Gemini call is the expensive one — a timeout
   *  burns the most wall-clock — and a run of them would keep issuing calls
   *  until the budget stopped it, well past MAX_TRANSCRIPTIONS_PER_RUN.
   *
   *  Cheap failures do not count. Marking a stale orphan 'failed' costs one
   *  list() and one UPDATE, so a backlog of orphans must not starve real work. */
  let attempts = 0;

  const cutoffIso = new Date(startedAt - STALE_AFTER_MS).toISOString();

  // ---- Tier 2a: a crashed transcription -------------------------------------
  // Same query shape as the uploading pass, against a different status value.
  // Deliberately not a second mechanism.
  const crashed = await ports.listStaleAnalyzing(
    cutoffIso,
    MAX_RECONCILIATIONS_PER_RUN,
  );

  for (const noteId of crashed) {
    if (await ports.claim(noteId, "analyzing", "failed")) {
      report.reconciled += 1;
      ports.log(
        `note ${noteId}: stuck in 'analyzing' past ${STALE_AFTER_MS}ms — ` +
          `the transcription function did not finish. Marked 'failed'.`,
      );
    }
  }

  // ---- Tier 2b: uploads that may or may not have landed ----------------------
  const candidates = await ports.listUploading(MAX_TRANSCRIPTIONS_PER_RUN * 4);

  for (const row of candidates) {
    if (attempts >= MAX_TRANSCRIPTIONS_PER_RUN) {
      report.deferred += 1;
      continue;
    }

    if (ports.now() - startedAt > RUN_BUDGET_MS) {
      report.deferred += 1;
      continue;
    }

    const ageMs = startedAt - Date.parse(row.updated_at);

    // Staleness enters the shared unit ONLY as this flag. It is the sweep's
    // whole contribution to the per-row decision: unattended reconciliation
    // must not false-fail an upload still in flight, whereas a user pressing
    // Transcribe has already decided the note is ready.
    //
    // The claim and the transcription are taken in two steps rather than
    // through claimAndTranscribe, because the cap counts rows that reached
    // Gemini. A cheap orphan failure costs one list() and one UPDATE and must
    // not hold a slot, so it has to be distinguishable here.
    const outcome = await claimNoteForTranscription(ports, row, {
      failOnMissingObject: ageMs > STALE_AFTER_MS,
      ageMs,
    });

    if (outcome === "waiting") {
      report.waiting += 1;
      continue;
    }

    if (outcome === "contended") {
      // Another tick got there first. Not an error.
      report.contended += 1;
      continue;
    }

    if (outcome === "no-object") {
      report.failed += 1;
      continue;
    }

    attempts += 1;
    const result = await transcribeClaimedNote(ports, row);
    if (result === "transcribed") report.transcribed += 1;
    else report.failed += 1;
  }

  // Never let a cap read as completeness — but only say "deferred" when work
  // was actually pushed aside. Rows still waiting on their upload are not a
  // backlog, and reporting them as one would cry wolf on every healthy tick.
  if (report.deferred > 0) {
    ports.log(
      `${report.deferred} row(s) deferred to the next tick — per-run cap ` +
        `${MAX_TRANSCRIPTIONS_PER_RUN} attempt(s), budget ${RUN_BUDGET_MS}ms.`,
    );
  }

  return report;
}
