import { claimAndGenerate } from "@/lib/notegen/generate-note";
import type { NoteGenerator } from "@/lib/notegen/gemini-client";
import type { NotegenStore } from "@/lib/notegen/persist-result";
import type { PersonaDepth } from "@/lib/notes/view-types";

/** All the branching, and none of the I/O.
 *
 *  notegen_status IS the queue, exactly as processing_status is
 *  transcription's. There is no job table here either: a row's own status says
 *  whether it is eligible, in flight, done or dead, and the transitions are
 *  the only coordination there is. A queue table would be a second source of
 *  truth that can disagree with the first.
 *
 *  Every side effect is an injected port, which is what lets claim races,
 *  staleness and caps be tested with no database and no network.
 *
 *  THIS FILE OWNS notegen_status AND NOTHING ELSE. lib/transcription/sweep.ts
 *  owns processing_status. The stale-row pass below is the same query SHAPE as
 *  that file's stale-'analyzing' pass, deliberately reimplemented here rather
 *  than reached across for — editing that file to handle a column it does not
 *  own is exactly the scope violation this project's conventions call out. */

/** A row is stale after an hour, matching transcription's threshold.
 *
 *  Here it means only one thing: the generation function died mid-flight. And
 *  unlike the transcription sweep, AGE ALONE IS TERMINAL. There, age could not
 *  fail a row on its own because an upload might still be arriving and object
 *  existence was the real safety check. Nothing is still arriving here — the
 *  transcript is already on the row, written before it ever became eligible —
 *  so there is no slow-but-real case to protect. */
export const NOTEGEN_STALE_AFTER_MS = 60 * 60 * 1000;

/** Above transcription's 3, and for a measured reason: a text-only call on
 *  roughly 12,000 tokens returns in seconds where an audio transcription takes
 *  minutes. The cap bounds COST; the shared budget bounds wall-clock, and on a
 *  run where transcription used the clock this phase claims nothing at all.
 *  Both still apply. */
export const MAX_NOTEGEN_PER_RUN = 5;

/** Failing a stale row is a status flip and no model call — cheap enough to
 *  clear a backlog in one tick. Same number and same reasoning as the
 *  transcription sweep's reconciliation cap. */
export const MAX_NOTEGEN_RECONCILIATIONS_PER_RUN = 25;

export interface GeneratableRow {
  id: string;
  user_id: string;
  raw_transcript: string | null;
  updated_at: string;
}

/** Which lens config a note generates under, and how that was decided.
 *
 *  `source` exists for the build report. "Which persona-resolution path
 *  executed" is a question that has to be answered with evidence, and a
 *  boolean inferred after the fact would be a guess. */
export interface ResolvedPersona {
  slug: string;
  name: string;
  depth: PersonaDepth;
  /** Which branch resolved this. "note" means the note carried an explicit
   *  persona_id — the lens its owner picked on Note Detail; "row" the
   *  neutral-analyst slug lookup; "fallback" an account with no personas rows
   *  at all. generate-note.ts prints it, so a build report can answer "which
   *  path ran" with evidence rather than inference. */
  source: "note" | "row" | "fallback";
}

/** What the guarded claim reports back.
 *
 *  A TAGGED UNION, not a nullable boolean, and that is deliberate. "Claimed,
 *  but the note carries no persona" and "lost the race" are both
 *  falsy-adjacent; collapsing them into boolean | string | null would leave
 *  them distinguishable only by a caller checking !== null against two
 *  different nullable things. This track's history already includes a
 *  data-loss bug caused by exactly one missing clause in this area — see
 *  deleteGeneratedChunks, 2026-09-02. */
export type ClaimResult =
  | { status: "claimed"; personaId: string | null }
  | { status: "lost" };

export interface NotegenPorts {
  now(): number;
  log(message: string): void;
  /** processing_status = 'completed' AND notegen_status IS NULL, oldest first. */
  listGeneratable(limit: number): Promise<GeneratableRow[]>;
  /** Still 'generating', with updated_at older than cutoffIso. */
  listStaleGenerating(cutoffIso: string, limit: number): Promise<string[]>;
  /** THE claim. One statement, one implementation, two callers. It carries
   *  persona_id out of its own RETURNING, so generation reads the value this
   *  UPDATE row-locked rather than one a later write could change. */
  claimForGeneration(noteId: string): Promise<ClaimResult>;
  /** The note's own persona_id first, then the neutral-analyst slug, then the
   *  fallback. Scoped by user_id throughout — never by name. See CLAUDE.md
   *  § Data and lib/notegen/resolve-persona.ts. */
  resolvePersona(
    userId: string,
    personaId: string | null,
  ): Promise<ResolvedPersona>;
  generate: NoteGenerator;
  store: NotegenStore;
}

/** The only observability this pipeline has. There is no error column, and the
 *  Vercel function log is where a run is read, so the counters have to
 *  distinguish causes rather than tally rows — a backlog the cap pushed aside
 *  and a handful of blank transcripts are very different situations. */
export interface NotegenReport {
  generated: number;
  failed: number;
  /** Stale 'generating' rows flipped to 'failed'. */
  reconciled: number;
  /** Pushed to the next tick by the per-run cap or the shared budget. */
  deferred: number;
  /** Claimed, then found to have no usable transcript. Terminal, and never a
   *  model call. */
  blank: number;
  /** An overlapping invocation claimed the row first. Not an error. */
  contended: number;
}

/** Phase two of the cron run.
 *
 *  deadlineAt is passed IN rather than computed here, and that is the whole
 *  point: this phase shares the transcription phase's clock. The route reads
 *  one startedAt, lets transcription spend from it, and hands what is left to
 *  this. Starting a second RUN_BUDGET_MS here would let one invocation run
 *  past the platform's 300 s hard ceiling and be killed mid-write. */
export async function notegenSweep(
  ports: NotegenPorts,
  options: { deadlineAt: number },
): Promise<NotegenReport> {
  const report: NotegenReport = {
    generated: 0,
    failed: 0,
    reconciled: 0,
    deferred: 0,
    blank: 0,
    contended: 0,
  };

  /** MODEL ATTEMPTS, which is what the cap must bound.
   *
   *  Counting successes instead would leave the cap inoperative in exactly the
   *  case it is sized for — a failing call is the expensive one, since a
   *  timeout burns the most wall-clock. Cheap rejections do not count: a
   *  contended claim and a blank transcript each cost one UPDATE and no model
   *  call, so a backlog of either must not starve real work. Same reasoning as
   *  the transcription sweep's `attempts`. */
  let attempts = 0;

  const cutoffIso = new Date(ports.now() - NOTEGEN_STALE_AFTER_MS).toISOString();

  // ---- Stale 'generating' rows ----------------------------------------------
  // The same query shape as the transcription sweep's stale-'analyzing' pass,
  // against this track's own column. Deliberately not a second mechanism, and
  // deliberately not a call into that file, which owns a different column.
  const crashed = await ports.listStaleGenerating(
    cutoffIso,
    MAX_NOTEGEN_RECONCILIATIONS_PER_RUN,
  );

  for (const noteId of crashed) {
    if (await ports.store.failNotegen(noteId)) {
      report.reconciled += 1;
      ports.log(
        `note ${noteId}: stuck in 'generating' past ${NOTEGEN_STALE_AFTER_MS}ms — ` +
          `the generation function did not finish. Marked 'failed'.`,
      );
    }
  }

  // ---- Eligible rows --------------------------------------------------------
  const candidates = await ports.listGeneratable(MAX_NOTEGEN_PER_RUN * 4);

  for (const row of candidates) {
    if (attempts >= MAX_NOTEGEN_PER_RUN) {
      report.deferred += 1;
      continue;
    }

    if (ports.now() > options.deadlineAt) {
      report.deferred += 1;
      continue;
    }

    const outcome = await claimAndGenerate(ports, row);

    if (outcome === "contended") {
      // Another tick got there first. Not an error, and not a spent slot.
      report.contended += 1;
      continue;
    }

    if (outcome === "blank") {
      report.blank += 1;
      continue;
    }

    // Only a row that actually reached the model spends a slot.
    attempts += 1;
    if (outcome === "generated") report.generated += 1;
    else report.failed += 1;
  }

  // Never let a cap read as completeness — but only say "deferred" when work
  // was genuinely pushed aside, so a healthy tick does not cry wolf.
  if (report.deferred > 0) {
    ports.log(
      `${report.deferred} row(s) deferred to the next tick — per-run cap ` +
        `${MAX_NOTEGEN_PER_RUN} attempt(s), shared budget ends at ` +
        `${options.deadlineAt}.`,
    );
  }

  return report;
}
