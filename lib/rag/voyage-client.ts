/** The Voyage AI wrapper, and the only file that knows the vendor exists.
 *
 *  ONE HTTP REQUEST PER CALL. Splitting a note's chunks across requests is
 *  policy, and policy lives in lib/rag/embed-note.ts — if this file looped, a
 *  failing sub-batch would drag its healthy siblings into the individual-retry
 *  path with it.
 *
 *  THE MODEL IS voyage-4, NOT voyage-3-large. The vendor decision in
 *  docs/DECISIONS.md § RAG named voyage-3-large; it was changed on 2026-09-03
 *  on cost, measured against docs.voyageai.com/docs/pricing that day.
 *  voyage-3-large is Voyage's legacy tier at $0.18/M tokens with no free
 *  allowance; voyage-4 is current-generation at $0.06/M with 200 million free
 *  tokens per account — and $0.06/M is the figure ROADMAP.md §3 already
 *  quoted, so the costing was right and only the name had drifted. Everything
 *  this file depends on is identical across the two: 1024 default dimension
 *  (also 2048/512/256), the same five dtypes, 32,000-token context. The one
 *  real difference is the per-request token cap — 320,000 against 120,000 —
 *  which only widens the headroom below.
 *
 *  Every field was read from the live docs on 2026-09-03
 *  (docs.voyageai.com/reference/embeddings-api and /docs/embeddings), never
 *  from memory. Three of them are PINNED rather than defaulted:
 *
 *    input_type: "document"  — Voyage is asymmetric. Stored content is a
 *      document; the question asked at retrieval time is a "query". Sending
 *      the wrong one silently degrades ranking rather than erroring, which is
 *      exactly the kind of bug a default would hide.
 *    output_dimension: 1024  — note_chunks.embedding is extensions.vector(1024),
 *      a FIXED width. voyage-4 defaults to 1024 today and also offers
 *      2048/512/256; a changed default would start writing vectors the column
 *      refuses.
 *    output_dtype: "float"   — the column stores float4. int8/binary would
 *      arrive as integers and be silently accepted as a nonsense vector.
 */

export const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";
export const VOYAGE_MODEL = "voyage-4";
export const VOYAGE_OUTPUT_DIMENSION = 1024;

/** The API accepts 1,000 texts and 320,000 tokens per request for voyage-4.
 *  Both caps are checked and whichever is reached first closes the batch, but
 *  in practice it is this one: a transcript segment runs 500-800 tokens, so
 *  128 of them is roughly 90,000 — comfortably inside the token cap. A note
 *  rarely has 128 chunks anyway, so the usual outcome is one request per note,
 *  which is the point. */
export const VOYAGE_MAX_BATCH_TEXTS = 128;

/** Well under voyage-4's documented 320,000-token per-request ceiling, with
 *  room for the estimate below being wrong in the cheap direction. It is not
 *  set nearer the ceiling because nothing gains by it — the text cap above
 *  closes every realistic batch first. */
export const VOYAGE_MAX_BATCH_TOKENS = 100_000;

/** The documented hard cap on `input` array length. */
const VOYAGE_INPUT_ITEM_LIMIT = 1000;

/** Four characters per token, the usual English rule of thumb, rounded up and
 *  floored at 1. This never needs to be accurate — it only needs to never
 *  UNDER-estimate badly enough to push a batch past the real cap, and the
 *  220,000-token headroom above absorbs the rest. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Why a failure happened, which is the only thing the retry cap cares about.
 *
 *  fatal      — 401/403. The key is wrong or revoked. This is a deployment
 *               problem, not a chunk problem, and it must abort the run rather
 *               than spend one of three attempts on every chunk in the table.
 *  transient  — 429, 5xx, or the network. The row stays eligible with its
 *               counter untouched; the next sweep tries again.
 *  content    — 400/422. The only kind that is evidence about this particular
 *               text, and therefore the only kind that increments. */
export type VoyageErrorKind = "fatal" | "transient" | "content";

/** Plain fields assigned in the body, NOT constructor parameter properties.
 *  scripts/verify-embeddings-pipeline.mjs imports this module through Node's
 *  native type stripping, which is strip-only and rejects `readonly kind:` in
 *  a parameter list with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. The verify scripts
 *  import the shipped code precisely so a copy cannot drift from it, so the
 *  shipped code has to stay loadable that way. */
export class VoyageError extends Error {
  readonly kind: VoyageErrorKind;
  readonly status: number | null;

  constructor(message: string, kind: VoyageErrorKind, status: number | null) {
    super(message);
    this.name = "VoyageError";
    this.kind = kind;
    this.status = status;
  }
}

function kindFor(status: number): VoyageErrorKind {
  if (status === 401 || status === 403) return "fatal";
  if (status === 429 || status >= 500) return "transient";
  return "content";
}

/** texts in, vectors out, same order. */
export type DocumentEmbedder = (texts: string[]) => Promise<number[][]>;

interface VoyageResponse {
  data?: { embedding?: unknown; index?: unknown }[];
  usage?: { total_tokens?: number };
}

export function createVoyageEmbedder(apiKey: string): DocumentEmbedder {
  return async (texts) => {
    if (texts.length === 0) return [];
    if (texts.length > VOYAGE_INPUT_ITEM_LIMIT) {
      throw new VoyageError(
        `refusing to send ${texts.length} texts: the documented cap is ` +
          `${VOYAGE_INPUT_ITEM_LIMIT} per request`,
        "content",
        null,
      );
    }

    let response: Response;
    try {
      response = await fetch(VOYAGE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: texts,
          model: VOYAGE_MODEL,
          input_type: "document",
          output_dimension: VOYAGE_OUTPUT_DIMENSION,
          output_dtype: "float",
          truncation: true,
        }),
      });
    } catch (error) {
      // DNS, TLS, socket. Nothing about the text, so nothing to charge it for.
      const reason = error instanceof Error ? error.message : String(error);
      throw new VoyageError(
        `voyage request failed: ${reason}`,
        "transient",
        null,
      );
    }

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 300);
      throw new VoyageError(
        `voyage returned ${response.status}: ${body}`,
        kindFor(response.status),
        response.status,
      );
    }

    const payload = (await response.json()) as VoyageResponse;
    const rows = payload.data ?? [];

    if (rows.length !== texts.length) {
      // Pairing vectors to chunks by position is the whole contract. A short
      // response would silently attach the wrong meaning to the wrong text.
      throw new VoyageError(
        `voyage returned ${rows.length} vector(s) for ${texts.length} text(s)`,
        "content",
        response.status,
      );
    }

    const ordered: number[][] = new Array(texts.length);
    for (const row of rows) {
      const index = typeof row.index === "number" ? row.index : -1;
      const embedding = row.embedding;

      if (index < 0 || index >= texts.length) {
        throw new VoyageError(
          `voyage returned an out-of-range index ${String(row.index)}`,
          "content",
          response.status,
        );
      }
      if (
        !Array.isArray(embedding) ||
        embedding.length !== VOYAGE_OUTPUT_DIMENSION
      ) {
        throw new VoyageError(
          `voyage returned a ${
            Array.isArray(embedding) ? embedding.length : "non-array"
          } vector; note_chunks.embedding is a fixed ` +
            `vector(${VOYAGE_OUTPUT_DIMENSION})`,
          "content",
          response.status,
        );
      }
      ordered[index] = embedding as number[];
    }

    return ordered;
  };
}
