import { planFor } from "@/lib/transcription/diarization-policy";
import {
  persistTranscription,
  type TranscriptionStore,
} from "@/lib/transcription/persist-result";
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

export interface SweepReport {
  transcribed: number;
  failed: number;
  reconciled: number;
  skipped: number;
}

export async function sweep(ports: SweepPorts): Promise<SweepReport> {
  const startedAt = ports.now();
  const report: SweepReport = {
    transcribed: 0,
    failed: 0,
    reconciled: 0,
    skipped: 0,
  };

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
    if (report.transcribed >= MAX_TRANSCRIPTIONS_PER_RUN) {
      report.skipped += 1;
      continue;
    }

    if (ports.now() - startedAt > RUN_BUDGET_MS) {
      report.skipped += 1;
      continue;
    }

    const ageMs = startedAt - Date.parse(row.updated_at);
    const stale = ageMs > STALE_AFTER_MS;

    const exists = row.audio_storage_path
      ? await ports.objectExists(row.audio_storage_path)
      : false;

    if (!exists) {
      if (!stale) {
        // A slow-but-real upload. Say nothing, do nothing, look again next tick.
        report.skipped += 1;
        continue;
      }

      if (await ports.claim(row.id, "uploading", "failed")) {
        report.failed += 1;
        ports.log(
          `note ${row.id}: no object at ${row.audio_storage_path ?? "(no path)"} ` +
            `after ${Math.round(ageMs / 60000)} min. The upload never landed. ` +
            `Marked 'failed'.`,
        );
      }
      continue;
    }

    if (!(await ports.claim(row.id, "uploading", "analyzing"))) {
      // Another tick got there first. Not an error.
      report.skipped += 1;
      continue;
    }

    const outcome = await transcribeOne(ports, row);
    if (outcome === "transcribed") report.transcribed += 1;
    else report.failed += 1;
  }

  const deferred = candidates.length - report.transcribed - report.failed;
  if (deferred > 0) {
    // Never let a cap read as completeness.
    ports.log(
      `${deferred} row(s) deferred to the next tick — per-run cap ` +
        `${MAX_TRANSCRIPTIONS_PER_RUN}, budget ${RUN_BUDGET_MS}ms.`,
    );
  }

  return report;
}

async function transcribeOne(
  ports: SweepPorts,
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
    // already proved with list() above — a CDN-cached read must never be the
    // thing that decides whether an object is there.
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
