import {
  attemptsIn,
  emptyReport,
  withEmbedAttempt,
  EMBED_CHUNK_WINDOW,
  MAX_EMBED_ATTEMPTS,
  type EmbedReport,
  type EmbeddingPorts,
  type PendingChunk,
} from "@/lib/rag/sweep";
import {
  estimateTokens,
  VoyageError,
  VOYAGE_MAX_BATCH_TEXTS,
  VOYAGE_MAX_BATCH_TOKENS,
} from "@/lib/rag/voyage-client";

/** ONE note's pending chunks, from listed to a terminal state. Both triggers
 *  call this: the cron sweep's third phase, and the deferred block of the
 *  Transcribe action once note generation has finished.
 *
 *  WHAT IS NOT HERE, DELIBERATELY: a claim.
 *
 *  Transcription and note generation both claim a row before spending, because
 *  a lost race there costs a duplicate GEMINI call — minutes of audio, real
 *  money. Here the two triggers may genuinely run at once on one note and the
 *  loser's cost is a duplicate VOYAGE call: $0.06 per million tokens on a note
 *  of roughly twelve thousand, against a 200-million-token free allowance,
 *  which is a rounding error. What must never happen is a duplicate or
 *  clobbering WRITE, and the per-row guard
 *  `UPDATE ... WHERE id = $1 AND embedding IS NULL` already makes that
 *  impossible on its own.
 *
 *  So there is no note-level lock, and adding one would buy nothing but a
 *  second coordination mechanism to get wrong. This is a deliberate deviation
 *  from the other two pipelines' shape, not an oversight. */

export type EmbedPorts = Pick<
  EmbeddingPorts,
  "log" | "embed" | "writeEmbedding" | "recordAttempt" | "listPendingForNote"
>;

/** Split a note's chunks into requests that fit BOTH documented caps.
 *
 *  A single chunk that is somehow over the token cap still gets its own batch
 *  rather than being dropped — Voyage's own `truncation: true` handles the
 *  overflow, and silently losing a chunk would be far worse than a truncated
 *  vector. */
export function batchesOf(chunks: PendingChunk[]): PendingChunk[][] {
  const batches: PendingChunk[][] = [];
  let current: PendingChunk[] = [];
  let tokens = 0;

  for (const chunk of chunks) {
    const cost = estimateTokens(chunk.content);
    const full =
      current.length >= VOYAGE_MAX_BATCH_TEXTS ||
      (current.length > 0 && tokens + cost > VOYAGE_MAX_BATCH_TOKENS);

    if (full) {
      batches.push(current);
      current = [];
      tokens = 0;
    }

    current.push(chunk);
    tokens += cost;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/** Write one vector, counting the outcome. A lost guard is contention, never
 *  a failure — it means the other trigger embedded this chunk first, which is
 *  the exact case the guard exists to make safe. */
async function writeOne(
  ports: EmbedPorts,
  report: EmbedReport,
  chunk: PendingChunk,
  vector: number[],
): Promise<void> {
  if (await ports.writeEmbedding(chunk.id, vector)) report.embedded += 1;
  else report.contended += 1;
}

/** Charge one chunk for its own failure.
 *
 *  ONLY called from the individual retry path. A chunk whose BATCH failed but
 *  which then succeeded alone is never charged, and neither is a healthy
 *  sibling of a poison chunk — that is the whole reason the fallback exists. */
async function chargeFailure(
  ports: EmbedPorts,
  report: EmbedReport,
  chunk: PendingChunk,
  reason: string,
): Promise<void> {
  const attempts = attemptsIn(chunk.metadata) + 1;
  await ports.recordAttempt(
    chunk.id,
    withEmbedAttempt(chunk.metadata, attempts, reason),
  );

  if (attempts >= MAX_EMBED_ATTEMPTS) {
    report.exhausted += 1;
    // The gap this leaves is recorded in docs/KNOWN_GAPS.md § "An unembeddable
    // chunk gives up silently". Nothing alerts; this line is the only trace.
    ports.log(
      `chunk ${chunk.id} (note ${chunk.note_id}): gave up after ` +
        `${MAX_EMBED_ATTEMPTS} attempt(s) — ${reason}. embedding stays null.`,
    );
  }
}

/** One chunk, alone, after its batch failed. */
async function retryAlone(
  ports: EmbedPorts,
  report: EmbedReport,
  chunk: PendingChunk,
): Promise<void> {
  try {
    const [vector] = await ports.embed([chunk.content]);
    await writeOne(ports, report, chunk, vector);
  } catch (error) {
    // A fatal error is a deployment problem — a wrong or revoked key. Charging
    // it to the chunk would spend all three attempts on every chunk in the
    // table before anybody noticed, so it propagates instead.
    if (error instanceof VoyageError && error.kind === "fatal") throw error;

    // Transient: a rate limit or a 5xx says nothing about this text. The row
    // stays eligible with its counter untouched and the next sweep retries.
    if (error instanceof VoyageError && error.kind === "transient") {
      report.retryable += 1;
      ports.log(
        `chunk ${chunk.id}: transient — ${error.message}. Still eligible.`,
      );
      return;
    }

    // Content, or anything unrecognised. An unrecognised throw is charged
    // rather than ignored: a bug that always throws would otherwise re-list
    // the same chunk on every sweep forever.
    const reason = error instanceof Error ? error.message : String(error);
    await chargeFailure(ports, report, chunk, reason);
  }
}

/** The unit. Batch first, and fall back to one-at-a-time only on failure. */
export async function embedChunks(
  ports: EmbedPorts,
  chunks: PendingChunk[],
): Promise<EmbedReport> {
  const report = emptyReport();
  if (chunks.length === 0) return report;

  // BLANK IS TERMINAL, NOT A SKIP. content is `not null` in the schema but may
  // still be whitespace. Skipping would leave the row eligible forever, so
  // every sweep would re-list it and a handful of blanks could starve real
  // work out of the per-run cap — the same reasoning as notegen's
  // blank-transcript guard, and like that one it is still before any model
  // call. It is taken straight to the cap so the eligibility filter drops it.
  const usable: PendingChunk[] = [];
  for (const chunk of chunks) {
    if (chunk.content.trim().length === 0) {
      report.blank += 1;
      await ports.recordAttempt(
        chunk.id,
        withEmbedAttempt(chunk.metadata, MAX_EMBED_ATTEMPTS, "blank content"),
      );
      ports.log(
        `chunk ${chunk.id} (note ${chunk.note_id}): blank content — ` +
          `terminal without a Voyage call.`,
      );
      continue;
    }
    usable.push(chunk);
  }

  for (const batch of batchesOf(usable)) {
    try {
      const vectors = await ports.embed(batch.map((c) => c.content));
      for (const [index, chunk] of batch.entries()) {
        await writeOne(ports, report, chunk, vectors[index]);
      }
    } catch (error) {
      if (error instanceof VoyageError && error.kind === "fatal") throw error;

      // A TRANSIENT FAILURE MUST NOT FAN OUT. A 429 or a 5xx says nothing
      // about any individual text, so calling each member alone cannot
      // produce a different answer — it turns one rejected request into
      // 1 + N rejected requests aimed at the very limit that rejected it.
      // Every member stays eligible with its counter untouched and the next
      // sweep retries the batch whole.
      if (error instanceof VoyageError && error.kind === "transient") {
        report.retryable += batch.length;
        ports.log(
          `note ${batch[0].note_id}: batch of ${batch.length} deferred ` +
            `(${error.message}). Still eligible.`,
        );
        continue;
      }

      // ONE MALFORMED CHUNK MUST NOT COST ITS SIBLINGS THEIR ATTEMPT. Only a
      // content error reaches here, and it told us nothing about WHICH text
      // was at fault — so every member gets its own call, purely to isolate
      // the poison one; only the chunks that fail alone are charged.
      const reason = error instanceof Error ? error.message : String(error);
      ports.log(
        `note ${batch[0].note_id}: batch of ${batch.length} failed (${reason}) — ` +
          `retrying each chunk individually.`,
      );
      for (const chunk of batch) await retryAlone(ports, report, chunk);
    }
  }

  return report;
}

/** The inline path's entry point: everything on ONE note that still has no
 *  vector. Called at the end of the transcription action's after() chain,
 *  where both transcript_segment and generated chunks already exist — which is
 *  why one call covers both. */
export async function embedNoteChunks(
  ports: EmbedPorts,
  noteId: string,
): Promise<EmbedReport> {
  const pending = await ports.listPendingForNote(noteId, EMBED_CHUNK_WINDOW);
  return embedChunks(ports, pending);
}
