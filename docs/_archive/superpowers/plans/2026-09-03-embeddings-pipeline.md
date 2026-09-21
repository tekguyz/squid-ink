# Embeddings Population Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. The owner has explicitly chosen **inline execution**, not
> subagent-driven development — this is a foundational build, not a parallel job.

**Goal:** Populate `note_chunks.embedding` with real Voyage `voyage-4`
vectors for every chunk, inline after generation and by daily cron backfill, and
prove with a live script that similarity search returns the right neighbour.

**Architecture:** `embedding IS NULL` on the chunk row IS the queue — the same
"a row's own state is the queue" philosophy `processing_status` and
`notegen_status` already carry, at chunk grain instead of note grain. No new
status column, no job table. A per-chunk guarded `UPDATE ... WHERE id = $1 AND
embedding IS NULL` is the whole concurrency story, so the inline path and the
cron sweep may safely race. Retry attempts are counted in the existing
`metadata` jsonb, merged never overwritten, capped at 3.

**Tech Stack:** TypeScript, Next.js 16 App Router Server Actions + `after()`,
Supabase JS 2.112.4 (PostgREST), pgvector `vector(1024)`, Voyage AI REST
(`https://api.voyageai.com/v1/embeddings`), Vitest 4.1.11.

**Spec:** The owner's prompt of 2026-09-03 ("Build the embeddings population
pipeline for note_chunks"), reproduced in the Global Constraints below. Live
sources consulted: `https://docs.voyageai.com/reference/embeddings-api`,
`https://docs.voyageai.com/docs/embeddings`,
`https://docs.voyageai.com/docs/rate-limits` (all fetched 2026-09-03).

---

## Global Constraints

- **Embedding vendor is locked:** Voyage AI **`voyage-4`**. Do not substitute.
  **This supersedes `voyage-3-large`, which `docs/DECISIONS.md` § RAG and
  ROADMAP.md §3 still name — the owner made the swap on 2026-09-03 and both
  documents are corrected in Task 9.** The reason is cost, measured against
  docs.voyageai.com/docs/pricing the same day: `voyage-3-large` is now Voyage's
  legacy tier at **$0.18/M tokens with no free allowance**, while `voyage-4` is
  current-generation at **$0.06/M with 200 million free tokens per account** —
  and $0.06/M is the figure ROADMAP.md §3 already quotes, so the ROADMAP's
  *number* was right and its *model name* was stale. Same 1024 default
  dimension, same 2048/512/256 options, same five dtypes, same 32,000-token
  context. The one genuinely model-specific difference is the per-request
  token cap: **320,000 for `voyage-4`** against 120,000 for `voyage-3-large`
  (verified live 2026-09-03), which only widens the headroom this plan already
  had.
- **`input_type` is always `"document"`.** The retrieval side owes `"query"`.
- **Pin `output_dimension: 1024` and `output_dtype: "float"` on every call.**
  The column is a fixed `extensions.vector(1024)`; never rely on an API default.
- **`VOYAGE_API_KEY` is server-only.** It must never be reachable from a file a
  `'use client'` component can import, and never carry a `NEXT_PUBLIC_` prefix.
- **Retry cap 3, tracked in `note_chunks.metadata` jsonb.** Merge into it, never
  overwrite — `transcript_segment` rows already carry `speaker`, `ts_start`,
  `ts_end`, `ts_start_seconds`, `ts_end_seconds` and `seq` there.
- **No new column, no new table, no new status enum.**
- **Do not filter the sweep by `user_id` in application code.** It runs as
  `service_role` and its entire job is to cross every user's pending chunks.
  This is not the persona-resolution exception in CLAUDE.md § Data; that rule
  does not apply here.
- **Files that must not change:** `lib/transcription/sweep.ts`,
  `lib/notegen/sweep.ts`, and `lib/notegen/generate-note.ts`'s claim logic.
- **No RLS policy or grant change on `note_chunks`.** The existing four
  owner-scoped policies and the existing `service_role` grant already cover
  this. Writing one means an assumption above is wrong — stop instead.
- **Schema-file-first.** Edit `supabase/schemas/note_chunks.sql`, then apply
  that exact file with `npx supabase db query --linked --file`. Never
  `apply_migration` while iterating, never inline DDL.
- **Soft ceiling 250 lines, hard ceiling 400** on shipped files.
  `components/note-detail/__tests__/project-conventions.test.ts` enforces 400.
- **No colour literals** in `components/` or `lib/` (no code here has colours,
  but the guard walks `lib/`).
- **Out of scope, do not build:** hybrid retrieval / reciprocal rank fusion, the
  ask-your-notes chat feature, any UI.

### Verified live API facts (2026-09-03) — do not re-derive from memory

| Fact | Value | Source |
|---|---|---|
| Endpoint | `POST https://api.voyageai.com/v1/embeddings` | reference/embeddings-api |
| Auth header | `Authorization: Bearer $VOYAGE_API_KEY` | reference/embeddings-api |
| `input` | string or array of strings, **max 1,000 items** | reference/embeddings-api |
| `input_type` | `null` \| `"query"` \| `"document"`, default `null` | reference/embeddings-api |
| `truncation` | boolean, default `true` | reference/embeddings-api |
| `output_dimension` | int, `voyage-4` supports 2048, **1024 (default)**, 512, 256 | docs/embeddings |
| `output_dtype` | `"float"` (default), `int8`, `uint8`, `binary`, `ubinary` | reference/embeddings-api |
| Per-request token cap | **320,000** for `voyage-4` | reference/embeddings-api |
| Per-text context | 32,000 tokens | docs/embeddings |
| Response | `{ object, data: [{ object, embedding, index }], model, usage: { total_tokens } }` | reference/embeddings-api |
| Rate limit, tier 1 | **2,000 RPM / 8,000,000 TPM** | docs/rate-limits |

---

## File Structure

**Create — `lib/rag/` (one folder deep, feature-grouped, per CLAUDE.md § File layout):**

| File | Responsibility |
|---|---|
| `lib/rag/voyage-client.ts` | The vendor wrapper. **One HTTP request per call.** Owns the endpoint, the pinned request shape, response validation, and the error taxonomy. Knows nothing about chunks or Supabase. |
| `lib/rag/sweep.ts` | The ports contract, the constants, the attempt-metadata merge policy, and `embeddingSweep` — cron phase three. Mirrors `lib/notegen/sweep.ts`'s shape. **Owns `note_chunks.embedding` and nothing else.** |
| `lib/rag/embed-note.ts` | One note's pending chunks, end to end: batching, the blank guard, the batch→individual fallback, the attempt cap. All branching, no I/O. Mirrors `lib/notegen/generate-note.ts`. |
| `lib/rag/supabase-ports.ts` | The one Supabase implementation of the ports — above all the guarded `UPDATE`. Reads no environment variable; the caller supplies the client. Mirrors `lib/transcription/supabase-ports.ts`. |
| `lib/rag/__tests__/*.test.ts` | Four test files, one per module. |
| `scripts/verify-embeddings-pipeline.mjs` | Live proof against the hosted project and the real Voyage API. Local only, never shipped. |

**Modify:**

| File | Change |
|---|---|
| `lib/notes/types.ts` | Add `embed_attempts?: number` and `embed_error?: string` to `ChunkMetadata`. |
| `supabase/schemas/note_chunks.sql` | Add the partial index on rows where `embedding is null`. |
| `app/notes/actions/transcription.ts` | One call at the end of the existing `after()` chain, on the already-hoisted deferred client. |
| `app/api/cron/transcribe/route.ts` | Phase three, on the same `startedAt`-derived deadline. |
| `components/note-detail/__tests__/project-conventions.test.ts` | New guard: `VOYAGE_API_KEY` is read from exactly the two shipped files. |
| `docs/KNOWN_GAPS.md` | Close the "Embeddings — still open" paragraph in place; add the silent-failure-after-3 entry. |
| `docs/DECISIONS.md` | One bullet in § RAG recording the queue design. |
| `CLAUDE.md` | New `## Embeddings` section; bump `**Last updated:**`. |

**Design decisions locked here, with their reasons:**

1. **The race is accepted, deliberately.** The inline `after()` call and the
   cron sweep can both reach one note. There is **no note-level lock and no
   claim-before-spend**, which is a conscious deviation from what transcription
   and notegen do. Their claim exists because a lost race would cost a
   *duplicate Gemini call* — minutes of audio, real money. Here a lost race
   costs a duplicate Voyage call, which at $0.06/1M tokens on ~12,000 tokens a
   note is a rounding error, and the guarded per-row `UPDATE` still makes a
   duplicate **write** impossible. Adding a lock would buy nothing and add a
   second coordination mechanism to get wrong.
2. **The blank guard is terminal, not a skip.** A whitespace-only chunk is
   marked with `embed_attempts = 3` immediately, with no Voyage call. Skipping
   it would leave it eligible forever, so every sweep would re-list it and a
   handful of blanks could starve real work out of the per-run cap — the same
   reasoning as notegen's blank-transcript guard. "After the claim" translates
   here to "after the row has been listed as pending and taken up by this
   process", which is the only claim this pipeline has.
3. **The attempt counter distinguishes three failure kinds.** A `401`/`403` is
   a *configuration* error and aborts the run without touching any counter — a
   bad key must not burn all three attempts on every chunk in the table. A
   `429` or `5xx` or network error is *transient* and also does not increment;
   the row stays eligible and the next sweep retries it. Only a
   *content* error (`400`, `422`) increments, because only that is evidence
   about the chunk itself.
4. **The metadata merge happens in the pure layer.** PostgREST cannot send a
   SQL expression, so `metadata = metadata || jsonb_build_object(...)` is not
   expressible through `supabase-js`. `withEmbedAttempt()` merges the object
   read in the same listing query and the guarded `UPDATE` writes the merged
   whole. The effect is identical and the merge itself becomes unit-testable —
   which is what makes "never overwrite `speaker`/`ts_start`/`seq`" a test
   rather than a promise.
5. **The vector crosses PostgREST as a string.** `JSON.stringify(vector)`
   produces `[0.1,0.2,…]`, which is pgvector's own text input format. Task 5
   proves this against the live table rather than assuming it.

---

## Task 1: The Voyage client

**Files:**
- Create: `lib/rag/voyage-client.ts`
- Test: `lib/rag/__tests__/voyage-client.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type DocumentEmbedder = (texts: string[]) => Promise<number[][]>`
  - `class VoyageError extends Error { kind: "fatal" | "transient" | "content"; status: number | null }`
  - `function createVoyageEmbedder(apiKey: string): DocumentEmbedder`
  - `const VOYAGE_MODEL = "voyage-4"`
  - `const VOYAGE_OUTPUT_DIMENSION = 1024`
  - `const VOYAGE_MAX_BATCH_TEXTS = 128`
  - `const VOYAGE_MAX_BATCH_TOKENS = 100_000`
  - `function estimateTokens(text: string): number`

- [ ] **Step 1: Write the failing tests**

Create `lib/rag/__tests__/voyage-client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createVoyageEmbedder,
  estimateTokens,
  VoyageError,
  VOYAGE_MAX_BATCH_TEXTS,
  VOYAGE_MAX_BATCH_TOKENS,
  VOYAGE_MODEL,
  VOYAGE_OUTPUT_DIMENSION,
} from "@/lib/rag/voyage-client";

const vector = (fill: number) => Array.from({ length: 1024 }, () => fill);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createVoyageEmbedder", () => {
  it("posts the pinned request shape to the documented endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        object: "list",
        data: [{ object: "embedding", embedding: vector(0.1), index: 0 }],
        model: VOYAGE_MODEL,
        usage: { total_tokens: 5 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createVoyageEmbedder("vk-test")(["hello"]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer vk-test",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      input: ["hello"],
      model: "voyage-4",
      input_type: "document",
      output_dimension: 1024,
      output_dtype: "float",
      truncation: true,
    });
  });

  it("returns vectors ordered by the response index, not by arrival", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({
        object: "list",
        data: [
          { object: "embedding", embedding: vector(0.2), index: 1 },
          { object: "embedding", embedding: vector(0.1), index: 0 },
        ],
        model: VOYAGE_MODEL,
        usage: { total_tokens: 9 },
      }),
    );

    const out = await createVoyageEmbedder("vk-test")(["a", "b"]);
    expect(out[0][0]).toBe(0.1);
    expect(out[1][0]).toBe(0.2);
  });

  it("rejects a vector of the wrong width — the column is fixed at 1024", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({
        object: "list",
        data: [{ object: "embedding", embedding: [1, 2, 3], index: 0 }],
        model: VOYAGE_MODEL,
        usage: { total_tokens: 1 },
      }),
    );

    await expect(createVoyageEmbedder("k")(["a"])).rejects.toThrow(/1024/);
  });

  it("rejects a short response rather than mis-pairing vectors to chunks", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({
        object: "list",
        data: [{ object: "embedding", embedding: vector(0.1), index: 0 }],
        model: VOYAGE_MODEL,
        usage: { total_tokens: 1 },
      }),
    );

    await expect(createVoyageEmbedder("k")(["a", "b"])).rejects.toThrow(
      /2 vector/,
    );
  });

  it("refuses more than the documented 1,000-item input cap before sending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const texts = Array.from({ length: 1001 }, () => "x");
    await expect(createVoyageEmbedder("k")(texts)).rejects.toThrow(/1000/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies 401 as fatal — a bad key must not burn every chunk's attempts", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ detail: "no" }, 401));
    const error = await createVoyageEmbedder("k")(["a"]).catch((e) => e);
    expect(error).toBeInstanceOf(VoyageError);
    expect(error.kind).toBe("fatal");
    expect(error.status).toBe(401);
  });

  it("classifies 429 and 503 as transient", async () => {
    for (const status of [429, 503]) {
      vi.stubGlobal("fetch", async () => jsonResponse({ detail: "later" }, status));
      const error = await createVoyageEmbedder("k")(["a"]).catch((e) => e);
      expect(error.kind).toBe("transient");
    }
  });

  it("classifies 400 as content — evidence about this text", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ detail: "bad" }, 400));
    const error = await createVoyageEmbedder("k")(["a"]).catch((e) => e);
    expect(error.kind).toBe("content");
  });

  it("classifies a network throw as transient", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const error = await createVoyageEmbedder("k")(["a"]).catch((e) => e);
    expect(error).toBeInstanceOf(VoyageError);
    expect(error.kind).toBe("transient");
    expect(error.status).toBeNull();
  });

  it("returns an empty array without calling the API for no input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await createVoyageEmbedder("k")([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("batch sizing constants", () => {
  it("stays well under the documented per-request caps", () => {
    expect(VOYAGE_MAX_BATCH_TEXTS).toBeLessThanOrEqual(1000);
    expect(VOYAGE_MAX_BATCH_TOKENS).toBeLessThanOrEqual(320_000);
    expect(VOYAGE_OUTPUT_DIMENSION).toBe(1024);
  });

  it("estimates tokens conservatively — never under four characters each", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run lib/rag/__tests__/voyage-client.test.ts`
Expected: FAIL — cannot resolve `@/lib/rag/voyage-client`.

- [ ] **Step 3: Write the implementation**

Create `lib/rag/voyage-client.ts`:

```ts
/** The Voyage AI wrapper, and the only file that knows the vendor exists.
 *
 *  ONE HTTP REQUEST PER CALL. Splitting a note's chunks across requests is
 *  policy, and policy lives in lib/rag/embed-note.ts — if this file looped, a
 *  failing sub-batch would drag its healthy siblings into the individual-retry
 *  path with it.
 *
 *  Every field below was read from the live docs on 2026-09-03
 *  (docs.voyageai.com/reference/embeddings-api and /docs/embeddings), never
 *  from memory. Three of them are PINNED rather than defaulted:
 *
 *    input_type: "document"  — Voyage is asymmetric. Stored content is a
 *      document; the question asked at retrieval time is a "query". Sending
 *      the wrong one silently degrades ranking rather than erroring, which is
 *      exactly the kind of bug a default would hide.
 *    output_dimension: 1024  — note_chunks.embedding is extensions.vector(1024),
 *      a FIXED width. voyage-4 happens to default to 1024 today and also
 *      offers 2048/512/256; a changed default would start writing vectors the
 *      column refuses.
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
 *  never has 128 chunks anyway, so the usual outcome is one request per note,
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
 *  20,000-token headroom above absorbs the rest. */
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

export class VoyageError extends Error {
  constructor(
    message: string,
    readonly kind: VoyageErrorKind,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "VoyageError";
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
      throw new VoyageError(`voyage request failed: ${reason}`, "transient", null);
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
      if (!Array.isArray(embedding) || embedding.length !== VOYAGE_OUTPUT_DIMENSION) {
        throw new VoyageError(
          `voyage returned a ${Array.isArray(embedding) ? embedding.length : "non-array"} ` +
            `vector; note_chunks.embedding is a fixed vector(${VOYAGE_OUTPUT_DIMENSION})`,
          "content",
          response.status,
        );
      }
      ordered[index] = embedding as number[];
    }

    return ordered;
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run lib/rag/__tests__/voyage-client.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/rag/voyage-client.ts lib/rag/__tests__/voyage-client.test.ts
git commit -m "feat(rag): add the Voyage embeddings client, pinned to 1024-dim float documents"
```

---

## Task 2: The ports contract and the attempt-metadata policy

**Files:**
- Create: `lib/rag/sweep.ts` (types, constants and `withEmbedAttempt` only —
  `embeddingSweep` arrives in Task 4)
- Modify: `lib/notes/types.ts` (add two optional fields to `ChunkMetadata`)
- Test: `lib/rag/__tests__/attempt-metadata.test.ts`

**Interfaces:**
- Consumes: `DocumentEmbedder` from Task 1.
- Produces:
  - `interface PendingChunk { id, note_id, user_id, content, metadata }`
  - `interface EmbeddingPorts { now, log, listPending, listPendingForNote, writeEmbedding, recordAttempt, embed }`
  - `interface EmbedReport { embedded, blank, exhausted, retryable, contended }`
  - `const MAX_EMBED_ATTEMPTS = 3`
  - `const MAX_EMBED_NOTES_PER_RUN = 10`
  - `const EMBED_CHUNK_WINDOW = 500`
  - `function attemptsIn(metadata: ChunkMetadata): number`
  - `function withEmbedAttempt(metadata: ChunkMetadata, attempts: number, reason: string): ChunkMetadata`

- [ ] **Step 1: Write the failing tests**

Create `lib/rag/__tests__/attempt-metadata.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  attemptsIn,
  withEmbedAttempt,
  MAX_EMBED_ATTEMPTS,
} from "@/lib/rag/sweep";
import type { ChunkMetadata } from "@/lib/notes/types";

/** A real transcript_segment metadata object, exactly as
 *  lib/transcription/persist-result.ts writes it. Nothing here may be lost. */
const TRANSCRIPT_METADATA: ChunkMetadata = {
  seq: 4,
  ts_start: "00:12",
  ts_end: "00:19",
  ts_start_seconds: 12.4,
  ts_end_seconds: 19.1,
  speaker: { name: "Speaker 2", initials: "S2", token: "speaker-2" },
};

describe("attemptsIn", () => {
  it("reads zero for a chunk that has never been tried", () => {
    expect(attemptsIn(TRANSCRIPT_METADATA)).toBe(0);
    expect(attemptsIn({})).toBe(0);
  });

  it("reads the recorded count", () => {
    expect(attemptsIn({ embed_attempts: 2 })).toBe(2);
  });

  it("treats a non-numeric value as zero rather than throwing", () => {
    expect(attemptsIn({ embed_attempts: "2" } as unknown as ChunkMetadata)).toBe(0);
  });
});

describe("withEmbedAttempt", () => {
  it("MERGES — it never overwrites the transcript's own metadata", () => {
    const merged = withEmbedAttempt(TRANSCRIPT_METADATA, 1, "voyage 400");

    expect(merged.seq).toBe(4);
    expect(merged.ts_start).toBe("00:12");
    expect(merged.ts_end).toBe("00:19");
    expect(merged.ts_start_seconds).toBe(12.4);
    expect(merged.ts_end_seconds).toBe(19.1);
    expect(merged.speaker).toEqual({
      name: "Speaker 2",
      initials: "S2",
      token: "speaker-2",
    });
    expect(merged.embed_attempts).toBe(1);
    expect(merged.embed_error).toBe("voyage 400");
  });

  it("does not mutate the object it was given", () => {
    const before = JSON.stringify(TRANSCRIPT_METADATA);
    withEmbedAttempt(TRANSCRIPT_METADATA, 3, "x");
    expect(JSON.stringify(TRANSCRIPT_METADATA)).toBe(before);
  });

  it("clamps at the cap, so the eligibility filter can enumerate 0..2", () => {
    expect(withEmbedAttempt({}, 9, "x").embed_attempts).toBe(MAX_EMBED_ATTEMPTS);
  });

  it("truncates a long reason — metadata is not a log", () => {
    const reason = "e".repeat(500);
    expect(withEmbedAttempt({}, 1, reason).embed_error).toHaveLength(200);
  });

  it("replaces the previous reason rather than accumulating history", () => {
    const first = withEmbedAttempt({}, 1, "first");
    const second = withEmbedAttempt(first, 2, "second");
    expect(second.embed_error).toBe("second");
    expect(second.embed_attempts).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run lib/rag/__tests__/attempt-metadata.test.ts`
Expected: FAIL — cannot resolve `@/lib/rag/sweep`.

- [ ] **Step 3: Extend `ChunkMetadata`**

In `lib/notes/types.ts`, inside `export interface ChunkMetadata { … }`, add
immediately after the `segment_id?: number;` line:

```ts
  /** Embedding retry bookkeeping, written by lib/rag/*. The chunk row's own
   *  `embedding IS NULL` is the queue; this is only the give-up counter, so a
   *  chunk that can never be embedded stops being retried forever. Merged into
   *  this object, never written over it — a transcript_segment's speaker and
   *  timestamps live here too. */
  embed_attempts?: number;
  /** The last failure reason, truncated. There is no error column at this
   *  scale and the Vercel log rotates; this is what a later operator reads. */
  embed_error?: string;
```

- [ ] **Step 4: Write `lib/rag/sweep.ts` (types, constants, policy)**

Create `lib/rag/sweep.ts`:

```ts
import type { ChunkMetadata } from "@/lib/notes/types";
import type { DocumentEmbedder } from "@/lib/rag/voyage-client";

/** All the branching, and none of the I/O.
 *
 *  `note_chunks.embedding IS NULL` IS THE QUEUE. Same philosophy as
 *  processing_status and notegen_status, at a different grain: embeddings are
 *  per CHUNK, not per note, so the queue state lives on the chunk row itself
 *  and there is no new status column and no job table. A column that is null
 *  until it is filled already says everything a 'pending' string would.
 *
 *  THIS FILE OWNS note_chunks.embedding AND NOTHING ELSE.
 *  lib/transcription/sweep.ts owns processing_status and lib/notegen/sweep.ts
 *  owns notegen_status. The stale/cap/deadline shape below is the same SHAPE
 *  as theirs, deliberately reimplemented rather than reached across for —
 *  editing either of those files to handle a column it does not own is exactly
 *  the scope violation this project's conventions call out. */

/** Three individual failures and the chunk is left alone permanently.
 *
 *  Counted in note_chunks.metadata, not in a new column: the column exists,
 *  is not null, defaults to '{}', and every consumer already reads it as a
 *  bag. A dedicated integer column would be a schema change carrying one
 *  number that only this pipeline reads. */
export const MAX_EMBED_ATTEMPTS = 3;

/** NOTES per cron run, not chunks. A run is capped by notes because a note is
 *  the batching unit — its chunks go to Voyage in one request.
 *
 *  Ten is deliberately conservative. The Voyage call itself is fast (sub-second
 *  for a note's worth of text, against a 2,000 RPM / 8,000,000 TPM tier-1
 *  limit we cannot approach at this volume). What actually costs wall-clock is
 *  the WRITE-BACK: one guarded UPDATE per chunk, because PostgREST cannot set a
 *  different value per row in one statement. A long note is ~100 chunks, so
 *  ten notes is up to ~1,000 round trips. The 300 s Hobby ceiling is now shared
 *  THREE ways, and this phase runs last. */
export const MAX_EMBED_NOTES_PER_RUN = 10;

/** How many pending chunks one sweep pulls before grouping them into notes.
 *  Wide enough that MAX_EMBED_NOTES_PER_RUN notes are actually reachable even
 *  when the oldest note is a long one. */
export const EMBED_CHUNK_WINDOW = 500;

/** A chunk waiting for its vector. Deliberately the columns and nothing more —
 *  the embedding itself is never read back, only written. */
export interface PendingChunk {
  id: string;
  note_id: string;
  user_id: string;
  content: string;
  metadata: ChunkMetadata;
}

export function attemptsIn(metadata: ChunkMetadata): number {
  const value = metadata?.embed_attempts;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** MERGE, NEVER OVERWRITE.
 *
 *  A transcript_segment chunk already carries speaker, ts_start, ts_end,
 *  ts_start_seconds, ts_end_seconds and seq in this same object, and the
 *  transcript pane renders every one of them. Replacing the object would empty
 *  the pane for a note that transcribed perfectly well.
 *
 *  PostgREST cannot send `metadata || jsonb_build_object(...)` — it has no way
 *  to express a SQL expression in an update. So the merge happens here, on the
 *  object the listing query already returned, and the guarded UPDATE writes
 *  the merged whole. Same result, and a unit test can hold it to it. */
export function withEmbedAttempt(
  metadata: ChunkMetadata,
  attempts: number,
  reason: string,
): ChunkMetadata {
  return {
    ...metadata,
    embed_attempts: Math.min(attempts, MAX_EMBED_ATTEMPTS),
    embed_error: reason.slice(0, 200),
  };
}

/** Every side effect, injected — which is what lets the batch fallback, the
 *  attempt cap and the contended write be tested with no database and no
 *  network. */
export interface EmbeddingPorts {
  now(): number;
  log(message: string): void;
  /** embedding IS NULL and under the attempt cap, oldest first, ACROSS EVERY
   *  USER. No user_id filter: this runs as service_role and crossing tenants
   *  is the entire job. */
  listPending(limit: number): Promise<PendingChunk[]>;
  /** The same predicate, narrowed to one note. The inline path's entry point. */
  listPendingForNote(noteId: string, limit: number): Promise<PendingChunk[]>;
  /** THE guarded write: UPDATE ... WHERE id = $1 AND embedding IS NULL.
   *  False means somebody else got there first — not an error. */
  writeEmbedding(chunkId: string, vector: number[]): Promise<boolean>;
  /** Writes the merged metadata back, guarded on embedding IS NULL so a chunk
   *  that succeeded elsewhere is never marked as having failed here. */
  recordAttempt(chunkId: string, metadata: ChunkMetadata): Promise<void>;
  embed: DocumentEmbedder;
}

/** The only observability this pipeline has. There is no error column, so the
 *  counters have to distinguish CAUSES rather than tally rows — a rate limit
 *  and a poison chunk are very different situations. */
export interface EmbedReport {
  embedded: number;
  /** Whitespace-only content. Terminal on sight, never a Voyage call. */
  blank: number;
  /** Reached MAX_EMBED_ATTEMPTS on this pass. Left null permanently. */
  exhausted: number;
  /** Failed transiently (429/5xx/network). Counter untouched, still eligible. */
  retryable: number;
  /** Another worker wrote the vector between our listing and our UPDATE. */
  contended: number;
}

export function emptyReport(): EmbedReport {
  return { embedded: 0, blank: 0, exhausted: 0, retryable: 0, contended: 0 };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run lib/rag/__tests__/attempt-metadata.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/rag/sweep.ts lib/rag/__tests__/attempt-metadata.test.ts lib/notes/types.ts
git commit -m "feat(rag): declare the embedding ports and the merge-never-overwrite attempt policy"
```

---

## Task 3: One note's chunks, end to end

**Files:**
- Create: `lib/rag/embed-note.ts`
- Test: `lib/rag/__tests__/embed-note.test.ts`

**Interfaces:**
- Consumes: `EmbeddingPorts`, `PendingChunk`, `EmbedReport`, `emptyReport`,
  `attemptsIn`, `withEmbedAttempt`, `MAX_EMBED_ATTEMPTS` from `lib/rag/sweep.ts`;
  `VoyageError`, `VOYAGE_MAX_BATCH_TEXTS`, `VOYAGE_MAX_BATCH_TOKENS`,
  `estimateTokens` from `lib/rag/voyage-client.ts`.
- Produces:
  - `function batchesOf(chunks: PendingChunk[]): PendingChunk[][]`
  - `function embedChunks(ports: EmbedPorts, chunks: PendingChunk[]): Promise<EmbedReport>`
  - `function embedNoteChunks(ports: EmbedPorts, noteId: string): Promise<EmbedReport>`
  - `type EmbedPorts = Pick<EmbeddingPorts, "log" | "embed" | "writeEmbedding" | "recordAttempt" | "listPendingForNote">`

- [ ] **Step 1: Write the failing tests**

Create `lib/rag/__tests__/embed-note.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { batchesOf, embedChunks, embedNoteChunks } from "@/lib/rag/embed-note";
import { MAX_EMBED_ATTEMPTS, type PendingChunk } from "@/lib/rag/sweep";
import { VoyageError } from "@/lib/rag/voyage-client";
import type { ChunkMetadata } from "@/lib/notes/types";

const vector = (fill: number) => Array.from({ length: 1024 }, () => fill);

function chunk(id: string, content = `content ${id}`, metadata: ChunkMetadata = {}): PendingChunk {
  return { id, note_id: "note-1", user_id: "user-1", content, metadata };
}

function harness(overrides: Partial<Parameters<typeof embedChunks>[0]> = {}) {
  const written = new Map<string, number[]>();
  const recorded = new Map<string, ChunkMetadata>();
  const embed = vi.fn(async (texts: string[]) => texts.map(() => vector(0.5)));

  const ports = {
    log: vi.fn(),
    embed,
    writeEmbedding: vi.fn(async (id: string, v: number[]) => {
      written.set(id, v);
      return true;
    }),
    recordAttempt: vi.fn(async (id: string, metadata: ChunkMetadata) => {
      recorded.set(id, metadata);
    }),
    listPendingForNote: vi.fn(async () => []),
    ...overrides,
  };

  return { ports, written, recorded, embed };
}

describe("batchesOf", () => {
  it("puts a small note in one batch — one Voyage call per note is the point", () => {
    const batches = batchesOf([chunk("a"), chunk("b"), chunk("c")]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it("splits on the text-count cap", () => {
    const many = Array.from({ length: 300 }, (_, i) => chunk(`c${i}`));
    const batches = batchesOf(many);
    expect(batches.every((b) => b.length <= 128)).toBe(true);
    expect(batches.flat()).toHaveLength(300);
  });

  it("splits on the token cap even when the count is small", () => {
    // 4 chars per estimated token, so 240,000 chars is ~60,000 tokens each.
    const huge = [chunk("a", "x".repeat(240_000)), chunk("b", "x".repeat(240_000))];
    expect(batchesOf(huge)).toHaveLength(2);
  });

  it("never drops a single over-sized chunk on the floor", () => {
    const monster = [chunk("a", "x".repeat(2_000_000))];
    const batches = batchesOf(monster);
    expect(batches).toHaveLength(1);
    expect(batches[0][0].id).toBe("a");
  });

  it("returns nothing for nothing", () => {
    expect(batchesOf([])).toEqual([]);
  });
});

describe("embedChunks — the happy path", () => {
  it("embeds a note's chunks in ONE call and writes each vector back", async () => {
    const { ports, written, embed } = harness();
    const report = await embedChunks(ports, [chunk("a"), chunk("b")]);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][0]).toEqual(["content a", "content b"]);
    expect(written.get("a")).toHaveLength(1024);
    expect(written.get("b")).toHaveLength(1024);
    expect(report.embedded).toBe(2);
    expect(report.exhausted).toBe(0);
  });

  it("counts a lost write as contended, not as a failure", async () => {
    const { ports } = harness({ writeEmbedding: vi.fn(async () => false) });
    const report = await embedChunks(ports, [chunk("a")]);

    expect(report.contended).toBe(1);
    expect(report.embedded).toBe(0);
    expect(ports.recordAttempt).not.toHaveBeenCalled();
  });

  it("does nothing at all for a note with no pending chunks", async () => {
    const { ports, embed } = harness();
    const report = await embedChunks(ports, []);
    expect(embed).not.toHaveBeenCalled();
    expect(report).toEqual({
      embedded: 0, blank: 0, exhausted: 0, retryable: 0, contended: 0,
    });
  });
});

describe("embedChunks — the blank guard", () => {
  it("takes a whitespace chunk terminal WITHOUT a Voyage call", async () => {
    const { ports, recorded, embed } = harness();
    const report = await embedChunks(ports, [chunk("blank", "  \n\t ")]);

    expect(embed).not.toHaveBeenCalled();
    expect(report.blank).toBe(1);
    expect(recorded.get("blank")?.embed_attempts).toBe(MAX_EMBED_ATTEMPTS);
  });

  it("does not let a blank chunk hold up its healthy siblings", async () => {
    const { ports, written, embed } = harness();
    const report = await embedChunks(ports, [chunk("blank", "   "), chunk("good")]);

    expect(embed.mock.calls[0][0]).toEqual(["content good"]);
    expect(written.has("good")).toBe(true);
    expect(report.embedded).toBe(1);
    expect(report.blank).toBe(1);
  });
});

describe("embedChunks — the batch fallback", () => {
  it("retries INDIVIDUALLY when the batch call fails, so one poison chunk does not cost its siblings their attempt", async () => {
    const embed = vi.fn(async (texts: string[]) => {
      if (texts.length > 1) throw new VoyageError("batch 400", "content", 400);
      if (texts[0] === "content poison") throw new VoyageError("bad", "content", 400);
      return texts.map(() => vector(0.5));
    });

    const { ports, written, recorded } = harness({ embed });
    const report = await embedChunks(ports, [chunk("poison", "content poison"), chunk("good")]);

    expect(written.has("good")).toBe(true);
    expect(report.embedded).toBe(1);
    // The healthy sibling's counter is untouched — it never failed on its own.
    expect(recorded.has("good")).toBe(false);
    expect(recorded.get("poison")?.embed_attempts).toBe(1);
  });

  it("increments to the cap and reports exhausted on the third individual failure", async () => {
    const embed = vi.fn(async () => {
      throw new VoyageError("bad", "content", 400);
    });
    const { ports, recorded } = harness({ embed });

    const report = await embedChunks(ports, [
      chunk("poison", "content poison", { embed_attempts: 2 }),
    ]);

    expect(recorded.get("poison")?.embed_attempts).toBe(MAX_EMBED_ATTEMPTS);
    expect(report.exhausted).toBe(1);
  });

  it("does NOT increment on a transient failure — a rate limit is not the chunk's fault", async () => {
    const embed = vi.fn(async () => {
      throw new VoyageError("429", "transient", 429);
    });
    const { ports, recorded } = harness({ embed });

    const report = await embedChunks(ports, [chunk("a")]);

    expect(ports.recordAttempt).not.toHaveBeenCalled();
    expect(recorded.size).toBe(0);
    expect(report.retryable).toBe(1);
    expect(report.exhausted).toBe(0);
  });

  it("ABORTS the whole run on a fatal error rather than burning every counter", async () => {
    const embed = vi.fn(async () => {
      throw new VoyageError("401", "fatal", 401);
    });
    const { ports } = harness({ embed });

    await expect(
      embedChunks(ports, [chunk("a"), chunk("b")]),
    ).rejects.toThrow(/401/);
    expect(ports.recordAttempt).not.toHaveBeenCalled();
  });

  it("treats a non-Voyage throw as content evidence, so it cannot loop forever", async () => {
    const embed = vi.fn(async () => {
      throw new Error("something else broke");
    });
    const { ports, recorded } = harness({ embed });

    const report = await embedChunks(ports, [chunk("a")]);
    expect(recorded.get("a")?.embed_attempts).toBe(1);
    expect(report.exhausted).toBe(0);
  });

  it("merges the failure into existing metadata rather than replacing it", async () => {
    const embed = vi.fn(async () => {
      throw new VoyageError("bad", "content", 400);
    });
    const { ports, recorded } = harness({ embed });

    await embedChunks(ports, [chunk("a", "hi", { seq: 7, ts_start: "00:03" })]);

    expect(recorded.get("a")).toMatchObject({
      seq: 7,
      ts_start: "00:03",
      embed_attempts: 1,
    });
  });
});

describe("embedNoteChunks", () => {
  it("lists the note's pending chunks and embeds them", async () => {
    const { ports, written } = harness({
      listPendingForNote: vi.fn(async () => [chunk("a"), chunk("b")]),
    });

    const report = await embedNoteChunks(ports, "note-1");

    expect(ports.listPendingForNote).toHaveBeenCalledWith("note-1", expect.any(Number));
    expect(written.size).toBe(2);
    expect(report.embedded).toBe(2);
  });

  it("spends no Voyage call when the note is already fully embedded", async () => {
    const { ports, embed } = harness({ listPendingForNote: vi.fn(async () => []) });
    const report = await embedNoteChunks(ports, "note-1");
    expect(embed).not.toHaveBeenCalled();
    expect(report.embedded).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run lib/rag/__tests__/embed-note.test.ts`
Expected: FAIL — cannot resolve `@/lib/rag/embed-note`.

- [ ] **Step 3: Write the implementation**

Create `lib/rag/embed-note.ts`:

```ts
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
 *  of roughly twelve thousand, which is a rounding error. What must never
 *  happen is a duplicate or clobbering WRITE, and the per-row guard
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
  await ports.recordAttempt(chunk.id, withEmbedAttempt(chunk.metadata, attempts, reason));

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
      ports.log(`chunk ${chunk.id}: transient — ${error.message}. Still eligible.`);
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

      // ONE MALFORMED CHUNK MUST NOT COST ITS SIBLINGS THEIR ATTEMPT. The
      // batch told us nothing about WHICH text was at fault, so every member
      // gets its own call; only the ones that fail alone are charged.
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run lib/rag/__tests__/embed-note.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/rag/embed-note.ts lib/rag/__tests__/embed-note.test.ts
git commit -m "feat(rag): embed one note's chunks, batched, with individual retry to isolate a poison chunk"
```

---

## Task 4: The cron sweep

**Files:**
- Modify: `lib/rag/sweep.ts` (append `embeddingSweep` and `EmbedSweepReport`)
- Test: `lib/rag/__tests__/sweep.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 and 3.
- Produces:
  - `interface EmbedSweepReport extends EmbedReport { notes: number; deferred: number }`
  - `function embeddingSweep(ports: EmbeddingPorts, options: { deadlineAt: number }): Promise<EmbedSweepReport>`

- [ ] **Step 1: Write the failing tests**

Create `lib/rag/__tests__/sweep.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  embeddingSweep,
  EMBED_CHUNK_WINDOW,
  MAX_EMBED_NOTES_PER_RUN,
  type PendingChunk,
} from "@/lib/rag/sweep";

const vector = (fill: number) => Array.from({ length: 1024 }, () => fill);

function chunk(id: string, noteId: string): PendingChunk {
  return { id, note_id: noteId, user_id: `user-${noteId}`, content: `text ${id}`, metadata: {} };
}

function harness(pending: PendingChunk[], now = () => 0) {
  const written: string[] = [];
  const embed = vi.fn(async (texts: string[]) => texts.map(() => vector(0.5)));

  const ports = {
    now,
    log: vi.fn(),
    embed,
    listPending: vi.fn(async () => pending),
    listPendingForNote: vi.fn(async (noteId: string) =>
      pending.filter((c) => c.note_id === noteId),
    ),
    writeEmbedding: vi.fn(async (id: string) => {
      written.push(id);
      return true;
    }),
    recordAttempt: vi.fn(async () => {}),
  };

  return { ports, written, embed };
}

describe("embeddingSweep", () => {
  it("groups pending chunks by note and sends ONE Voyage call per note", async () => {
    const { ports, embed, written } = harness([
      chunk("a1", "note-a"),
      chunk("b1", "note-b"),
      chunk("a2", "note-a"),
    ]);

    const report = await embeddingSweep(ports, { deadlineAt: Infinity });

    expect(embed).toHaveBeenCalledTimes(2);
    expect(report.notes).toBe(2);
    expect(report.embedded).toBe(3);
    expect(written).toHaveLength(3);
  });

  it("asks for a wide enough window to reach the note cap", async () => {
    const { ports } = harness([]);
    await embeddingSweep(ports, { deadlineAt: Infinity });
    expect(ports.listPending).toHaveBeenCalledWith(EMBED_CHUNK_WINDOW);
  });

  it("does not filter by user — crossing every tenant is the whole job", async () => {
    const { ports, embed } = harness([chunk("a1", "note-a"), chunk("b1", "note-b")]);
    await embeddingSweep(ports, { deadlineAt: Infinity });
    // One call per note regardless of the two different user_ids.
    expect(embed).toHaveBeenCalledTimes(2);
    expect(ports.listPending).toHaveBeenCalledTimes(1);
  });

  it("stops at the per-run note cap and reports the rest as deferred", async () => {
    const chunks = Array.from({ length: MAX_EMBED_NOTES_PER_RUN + 3 }, (_, i) =>
      chunk(`c${i}`, `note-${i}`),
    );
    const { ports, embed } = harness(chunks);

    const report = await embeddingSweep(ports, { deadlineAt: Infinity });

    expect(report.notes).toBe(MAX_EMBED_NOTES_PER_RUN);
    expect(embed).toHaveBeenCalledTimes(MAX_EMBED_NOTES_PER_RUN);
    expect(report.deferred).toBe(3);
  });

  it("stops claiming new work past the SHARED deadline", async () => {
    const clock = { value: 0 };
    const { ports, embed } = harness(
      [chunk("a1", "note-a"), chunk("b1", "note-b")],
      () => clock.value,
    );
    ports.writeEmbedding = vi.fn(async () => {
      clock.value = 999; // the first note used the whole budget
      return true;
    });

    const report = await embeddingSweep(ports, { deadlineAt: 100 });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(report.notes).toBe(1);
    expect(report.deferred).toBe(1);
  });

  it("returns an all-zero report and spends nothing on a fully embedded table", async () => {
    const { ports, embed } = harness([]);
    const report = await embeddingSweep(ports, { deadlineAt: Infinity });

    expect(embed).not.toHaveBeenCalled();
    expect(report).toEqual({
      notes: 0, embedded: 0, blank: 0, exhausted: 0,
      retryable: 0, contended: 0, deferred: 0,
    });
  });

  it("rolls each note's counters into the run total", async () => {
    const pending = [
      { ...chunk("blank", "note-a"), content: "   " },
      chunk("good", "note-a"),
    ];
    const { ports } = harness(pending);

    const report = await embeddingSweep(ports, { deadlineAt: Infinity });

    expect(report.blank).toBe(1);
    expect(report.embedded).toBe(1);
    expect(report.notes).toBe(1);
  });

  it("logs when work was pushed aside, and stays quiet when it was not", async () => {
    const { ports } = harness([chunk("a1", "note-a")]);
    await embeddingSweep(ports, { deadlineAt: Infinity });
    expect(ports.log).not.toHaveBeenCalledWith(expect.stringContaining("deferred"));
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run lib/rag/__tests__/sweep.test.ts`
Expected: FAIL — `embeddingSweep` is not exported.

- [ ] **Step 3: Append the implementation to `lib/rag/sweep.ts`**

Add these imports at the top of `lib/rag/sweep.ts` (below the existing ones):

```ts
import { embedChunks } from "@/lib/rag/embed-note";
```

Append at the end of the file:

```ts
/** The run's own counters on top of the per-note ones. */
export interface EmbedSweepReport extends EmbedReport {
  /** Notes this run actually took up. */
  notes: number;
  /** Notes pushed to the next tick by the per-run cap or the shared budget. */
  deferred: number;
}

/** PHASE THREE of the cron run, and the BACKFILL.
 *
 *  It is both at once and deliberately so: "every chunk with no vector,
 *  oldest first, across every user" describes the rows the inline path missed
 *  AND every row that existed before this pipeline shipped. A separate
 *  one-shot backfill script would be a second implementation of the same
 *  query, and it would be dead code the day after it ran.
 *
 *  NO user_id FILTER. The standing rule in CLAUDE.md § Supabase → RLS rules is
 *  that queries never filter on user_id in application code, and this obeys
 *  it: the sweep runs as service_role, which bypasses RLS, and crossing every
 *  tenant's pending chunks is its entire purpose. This is NOT the
 *  persona-resolution exception, which filters precisely because an unfiltered
 *  single-row lookup could return the wrong account's row — there is no wrong
 *  account here.
 *
 *  deadlineAt is passed IN rather than computed, the same "one clock, N
 *  phases" rule note generation established against transcription's budget.
 *  The route reads one startedAt; transcription spends from it, note
 *  generation spends what is left, and this gets the remainder. A third
 *  independent budget would let one invocation run past the 300 s Hobby
 *  ceiling and be killed mid-write. This phase runs LAST, so on a busy run it
 *  is the one that defers — which is correct: a missing vector is invisible
 *  until retrieval ships, and tomorrow's sweep picks it up. */
export async function embeddingSweep(
  ports: EmbeddingPorts,
  options: { deadlineAt: number },
): Promise<EmbedSweepReport> {
  const report: EmbedSweepReport = { ...emptyReport(), notes: 0, deferred: 0 };

  const pending = await ports.listPending(EMBED_CHUNK_WINDOW);
  if (pending.length === 0) return report;

  // Grouped in listing order, which is oldest-chunk-first, so the note that
  // has waited longest is taken up first.
  const byNote = new Map<string, PendingChunk[]>();
  for (const chunk of pending) {
    const group = byNote.get(chunk.note_id);
    if (group) group.push(chunk);
    else byNote.set(chunk.note_id, [chunk]);
  }

  for (const [noteId, chunks] of byNote) {
    if (report.notes >= MAX_EMBED_NOTES_PER_RUN || ports.now() > options.deadlineAt) {
      report.deferred += 1;
      continue;
    }

    // The SAME unit the inline trigger calls. The chunks are already in hand
    // from the window above, so this takes embedChunks directly rather than
    // embedNoteChunks — one fewer round trip, identical behaviour.
    const noteReport = await embedChunks(ports, chunks);

    report.notes += 1;
    report.embedded += noteReport.embedded;
    report.blank += noteReport.blank;
    report.exhausted += noteReport.exhausted;
    report.retryable += noteReport.retryable;
    report.contended += noteReport.contended;

    if (noteReport.embedded > 0) {
      ports.log(`note ${noteId}: embedded ${noteReport.embedded} chunk(s).`);
    }
  }

  // Never let a cap read as completeness — but only say "deferred" when work
  // was genuinely pushed aside, so a healthy tick does not cry wolf.
  if (report.deferred > 0) {
    ports.log(
      `${report.deferred} note(s) deferred to the next tick — per-run cap ` +
        `${MAX_EMBED_NOTES_PER_RUN} note(s), shared budget ends at ` +
        `${options.deadlineAt}.`,
    );
  }

  return report;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run lib/rag/__tests__/sweep.test.ts`
Expected: PASS, 8 tests.

> **Note on the circular import:** `sweep.ts` imports `embedChunks` from
> `embed-note.ts`, which imports types and helpers from `sweep.ts`. This is the
> identical shape `lib/notegen/sweep.ts` and `lib/notegen/generate-note.ts`
> already have and it resolves fine — the type imports erase, and the value
> import is used only inside a function body. If `npx tsc --noEmit` or the test
> run reports a cycle problem, do **not** restructure into a `types.ts`; check
> that `embed-note.ts` imports nothing from `sweep.ts` at module evaluation
> time.

- [ ] **Step 5: Commit**

```bash
git add lib/rag/sweep.ts lib/rag/__tests__/sweep.test.ts
git commit -m "feat(rag): add the cross-user embedding sweep, sharing the cron run's one clock"
```

---

## Task 5: The Supabase ports

**Files:**
- Create: `lib/rag/supabase-ports.ts`
- Test: `lib/rag/__tests__/supabase-ports.test.ts`

**Interfaces:**
- Consumes: `EmbeddingPorts`, `PendingChunk`, `MAX_EMBED_ATTEMPTS` from
  `lib/rag/sweep.ts`; `createVoyageEmbedder` from `lib/rag/voyage-client.ts`.
- Produces: `function createEmbeddingPorts(db: SupabaseClient, voyageKey: string): EmbeddingPorts`

**The eligibility filter, and why it is written this way.** A chunk is eligible
when `embedding is null` **and** it has not reached the attempt cap. The count
lives inside a jsonb object, and PostgREST compares `metadata->>embed_attempts`
as **text** — so `lt.3` would be a lexicographic comparison, which is a trap
waiting for a two-digit number. The filter therefore enumerates the acceptable
values exactly, generated from the constant so the two can never drift:

```ts
`metadata->>embed_attempts.is.null,metadata->>embed_attempts.in.(${[...Array(MAX_EMBED_ATTEMPTS).keys()].join(",")})`
```

which is `is.null,in.(0,1,2)` — a chunk never tried, or tried fewer than three
times. Exact, no cast, no ordering assumption.

- [ ] **Step 1: Write the failing tests**

Create `lib/rag/__tests__/supabase-ports.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createEmbeddingPorts } from "@/lib/rag/supabase-ports";
import { MAX_EMBED_ATTEMPTS } from "@/lib/rag/sweep";

/** A chainable PostgREST double that records every filter it was given. */
function queryDouble(result: { data?: unknown; error?: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};

  for (const method of ["select", "eq", "is", "or", "order", "limit", "update", "delete", "in"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  // Awaiting the chain resolves to the PostgREST result.
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);

  return { chain, calls };
}

function dbDouble(result: { data?: unknown; error?: unknown }) {
  const { chain, calls } = queryDouble(result);
  const from = vi.fn(() => chain);
  return { db: { from } as never, calls, from };
}

describe("listPending", () => {
  it("filters on embedding IS NULL and the attempt cap, oldest first, with NO user filter", async () => {
    const { db, calls } = dbDouble({ data: [], error: null });
    await createEmbeddingPorts(db, "k").listPending(500);

    const is = calls.filter((c) => c.method === "is");
    expect(is).toContainEqual({ method: "is", args: ["embedding", null] });

    const or = calls.find((c) => c.method === "or");
    expect(or?.args[0]).toBe(
      "metadata->>embed_attempts.is.null,metadata->>embed_attempts.in.(0,1,2)",
    );

    expect(calls.find((c) => c.method === "order")?.args[0]).toBe("created_at");
    expect(calls.find((c) => c.method === "limit")?.args[0]).toBe(500);

    // The whole job is crossing tenants. A user_id filter here would be a bug.
    expect(calls.some((c) => c.args[0] === "user_id")).toBe(false);
  });

  it("throws with the PostgREST message rather than returning an empty list", async () => {
    const { db } = dbDouble({ data: null, error: { message: "boom" } });
    await expect(createEmbeddingPorts(db, "k").listPending(10)).rejects.toThrow(/boom/);
  });
});

describe("listPendingForNote", () => {
  it("adds the note filter to the same predicate", async () => {
    const { db, calls } = dbDouble({ data: [], error: null });
    await createEmbeddingPorts(db, "k").listPendingForNote("note-1", 500);

    expect(calls).toContainEqual({ method: "eq", args: ["note_id", "note-1"] });
    expect(calls.filter((c) => c.method === "is")).toContainEqual({
      method: "is",
      args: ["embedding", null],
    });
  });
});

describe("writeEmbedding", () => {
  it("is GUARDED on embedding IS NULL and reports winning the race", async () => {
    const { db, calls } = dbDouble({ data: [{ id: "c1" }], error: null });
    const won = await createEmbeddingPorts(db, "k").writeEmbedding("c1", [0.1, 0.2]);

    expect(won).toBe(true);
    expect(calls.find((c) => c.method === "update")?.args[0]).toEqual({
      embedding: "[0.1,0.2]",
    });
    expect(calls).toContainEqual({ method: "eq", args: ["id", "c1"] });
    expect(calls).toContainEqual({ method: "is", args: ["embedding", null] });
  });

  it("reports losing the race when the guard matched nothing", async () => {
    const { db } = dbDouble({ data: [], error: null });
    expect(await createEmbeddingPorts(db, "k").writeEmbedding("c1", [0.1])).toBe(false);
  });

  it("throws on a real error rather than reporting a lost race", async () => {
    const { db } = dbDouble({ data: null, error: { message: "nope" } });
    await expect(
      createEmbeddingPorts(db, "k").writeEmbedding("c1", [0.1]),
    ).rejects.toThrow(/nope/);
  });
});

describe("recordAttempt", () => {
  it("writes the merged metadata, still guarded on embedding IS NULL", async () => {
    const { db, calls } = dbDouble({ data: [{ id: "c1" }], error: null });
    await createEmbeddingPorts(db, "k").recordAttempt("c1", {
      seq: 2,
      embed_attempts: 1,
      embed_error: "voyage 400",
    });

    expect(calls.find((c) => c.method === "update")?.args[0]).toEqual({
      metadata: { seq: 2, embed_attempts: 1, embed_error: "voyage 400" },
    });
    expect(calls).toContainEqual({ method: "is", args: ["embedding", null] });
  });
});

describe("createEmbeddingPorts", () => {
  it("keeps the attempt list in step with the constant", () => {
    expect(MAX_EMBED_ATTEMPTS).toBe(3);
  });

  it("reads no environment variable — the caller supplies both dependencies", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("lib/rag/supabase-ports.ts", "utf8"),
    );
    expect(source).not.toContain("process.env");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run lib/rag/__tests__/supabase-ports.test.ts`
Expected: FAIL — cannot resolve `@/lib/rag/supabase-ports`.

- [ ] **Step 3: Write the implementation**

Create `lib/rag/supabase-ports.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChunkMetadata } from "@/lib/notes/types";
import {
  MAX_EMBED_ATTEMPTS,
  type EmbeddingPorts,
  type PendingChunk,
} from "@/lib/rag/sweep";
import { createVoyageEmbedder } from "@/lib/rag/voyage-client";

/** The Supabase implementation of EmbeddingPorts — the only place in this
 *  track that turns the state machine's ports into real queries.
 *
 *  THE GUARDED UPDATE IS THE REASON THIS IS ONE FILE. A second copy of
 *  `update(embedding) where id = $1 and embedding is null` would be a second
 *  mechanism for the one guarantee this pipeline depends on. Both triggers —
 *  the after() chain and the cron sweep — build their ports here.
 *
 *  Nothing here reads an environment variable. The caller supplies the client,
 *  which is what lets the cron pass a secret-key client (no session, so no RLS
 *  identity, so it can reach every user's chunks) and the Server Action pass a
 *  token client (RLS supplies the owner) without this file knowing which.
 *  Same shape as lib/transcription/supabase-ports.ts. */

const PENDING_COLUMNS = "id, note_id, user_id, content, metadata";

/** Eligible = never tried, or tried fewer than MAX_EMBED_ATTEMPTS times.
 *
 *  Enumerated rather than compared. PostgREST evaluates `metadata->>x` as
 *  TEXT, so `lt.3` would be a lexicographic comparison — correct for one digit
 *  and quietly wrong the moment the cap goes to ten. The list is generated
 *  from the constant so the filter and the cap cannot drift apart. */
const ELIGIBLE_ATTEMPTS =
  `metadata->>embed_attempts.is.null,` +
  `metadata->>embed_attempts.in.(${[...Array(MAX_EMBED_ATTEMPTS).keys()].join(",")})`;

export function createEmbeddingPorts(
  db: SupabaseClient,
  voyageKey: string,
): EmbeddingPorts {
  return {
    now: () => Date.now(),
    log: (message) => console.log(`[embed] ${message}`),

    async listPending(limit) {
      // NO .eq("user_id", ...). The standing rule is that queries never filter
      // on user_id in application code, and this obeys it — the sweep runs as
      // service_role and crossing every tenant is the whole job.
      const { data, error } = await db
        .from("note_chunks")
        .select(PENDING_COLUMNS)
        .is("embedding", null)
        .or(ELIGIBLE_ATTEMPTS)
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) throw new Error(`listing pending chunks failed: ${error.message}`);
      return (data ?? []) as PendingChunk[];
    },

    async listPendingForNote(noteId, limit) {
      const { data, error } = await db
        .from("note_chunks")
        .select(PENDING_COLUMNS)
        .eq("note_id", noteId)
        .is("embedding", null)
        .or(ELIGIBLE_ATTEMPTS)
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(`listing pending chunks for ${noteId} failed: ${error.message}`);
      }
      return (data ?? []) as PendingChunk[];
    },

    async writeEmbedding(chunkId, vector) {
      // THE guard. Postgres row-locks the matched row, so a concurrent worker
      // re-evaluates `embedding is null` after the lock releases and matches
      // nothing. That is what makes the inline path and the sweep safe to race
      // with no note-level lock: a duplicate Voyage CALL is possible and cheap,
      // a duplicate or clobbering WRITE is not possible at all.
      //
      // The vector crosses as a string: JSON.stringify produces "[0.1,0.2]",
      // which is pgvector's own text input format. Sending the raw array would
      // leave PostgREST to serialise it as a JSON array, which is a different
      // type to the column.
      const { data, error } = await db
        .from("note_chunks")
        .update({ embedding: JSON.stringify(vector) })
        .eq("id", chunkId)
        .is("embedding", null)
        .select("id");

      if (error) throw new Error(`writing embedding for ${chunkId} failed: ${error.message}`);
      return (data?.length ?? 0) === 1;
    },

    async recordAttempt(chunkId, metadata: ChunkMetadata) {
      // Guarded on embedding IS NULL too: if the other trigger embedded this
      // chunk while we were failing on it, there is nothing to record and the
      // successful metadata must not be stamped with our error.
      //
      // The object written is the MERGE that withEmbedAttempt already
      // performed on the metadata read in the listing query. PostgREST cannot
      // send `metadata || jsonb_build_object(...)`, so the merge is done in
      // the pure layer and the whole merged object is written here.
      const { error } = await db
        .from("note_chunks")
        .update({ metadata })
        .eq("id", chunkId)
        .is("embedding", null);

      if (error) {
        // Logged, not thrown. The caller is already on a failure path and a
        // throw here would replace the real reason with this one. Same
        // reasoning as failNotegen in lib/notegen/notegen-ports.ts.
        console.error(`[embed] could not record an attempt on ${chunkId}`, error.message);
      }
    },

    embed: createVoyageEmbedder(voyageKey),
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run lib/rag/__tests__/supabase-ports.test.ts`
Expected: PASS, 8 tests.

> If `writeEmbedding` later turns out to be rejected by the live table because
> of the string form, Task 8's proof will catch it. The fix is
> `update({ embedding: vector })` — do **not** guess now; Task 8 measures it.

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
npx tsc --noEmit
npx vitest run
git add lib/rag/supabase-ports.ts lib/rag/__tests__/supabase-ports.test.ts
git commit -m "feat(rag): add the one Supabase implementation of the guarded embedding write"
```

---

## Task 6: The partial index

**Files:**
- Modify: `supabase/schemas/note_chunks.sql`

**Interfaces:** none — this is schema only.

- [ ] **Step 1: Add the index to the schema file**

In `supabase/schemas/note_chunks.sql`, immediately after the existing
`note_chunks_embedding_idx` hnsw index block, insert:

```sql
-- The embedding QUEUE, as opposed to the retrieval index above.
--
-- lib/rag/sweep.ts asks one question on every cron run: "which chunks, across
-- every user, still have no vector?" Without this the answer is a sequential
-- scan of the whole table, and it gets slower with every note ever recorded —
-- while the set it is looking for shrinks towards empty. A partial index
-- inverts that: it holds only the rows that are actually pending, so a fully
-- embedded table is answered from an index with no entries in it.
--
-- Keyed on created_at because that is the sweep's ORDER BY: oldest chunk
-- first, so the note that has waited longest is taken up first.
--
-- `embedding is null` is immutable, which is what a partial index predicate
-- requires. The attempt cap is deliberately NOT in the predicate: it reads
-- metadata, and a chunk that has given up permanently is a rounding error in
-- the index while a jsonb predicate would make every UPDATE re-evaluate it.
create index if not exists note_chunks_pending_embedding_idx
  on public.note_chunks (created_at)
  where embedding is null;
```

- [ ] **Step 1b: Correct the column's own comment in the same file**

The `embedding` column's comment in `supabase/schemas/note_chunks.sql` names
the superseded model and says the pipeline does not exist. Both are now false.
Replace:

```sql
  -- voyage-3-large output width (ROADMAP.md §3). Null until the embedding
  -- pipeline ships — no embedding code is in scope for this prompt.
  embedding extensions.vector(1024),
```

with:

```sql
  -- voyage-4 output width, pinned on every call in lib/rag/voyage-client.ts
  -- rather than taken from the API default — 1024 is that model's default
  -- today, but it also offers 2048/512/256 and this column is FIXED.
  -- Populated since 2026-09-03; null means "not embedded yet", which is the
  -- queue itself (CLAUDE.md § Embeddings). The model changed from
  -- voyage-3-large on cost grounds the same day; see docs/DECISIONS.md § RAG.
  embedding extensions.vector(1024),
```

- [ ] **Step 2: Apply the schema file to the linked project**

Schema-file-first, per CLAUDE.md § Supabase. Never inline DDL, never
`apply_migration` while iterating. Every statement in the file is idempotent so
re-running the whole file is the intended way to iterate.

```bash
npx supabase db query --linked --file supabase/schemas/note_chunks.sql
```

Expected: success with no output rows. If it asks for a project ref, add
`--project-ref <ref>` read from `.supabase/` or the Supabase dashboard.

- [ ] **Step 3: Read the live catalog back**

`db diff` is unavailable without Docker, so verification is a catalog read:

```bash
npx supabase db query --linked "select indexname, indexdef from pg_indexes where tablename = 'note_chunks' order by indexname;"
```

Expected: `note_chunks_pending_embedding_idx` present, with
`WHERE (embedding IS NULL)` in its definition.

- [ ] **Step 4: Confirm the query actually uses it**

```bash
npx supabase db query --linked "explain select id from public.note_chunks where embedding is null order by created_at limit 500;"
```

Expected: an `Index Scan using note_chunks_pending_embedding_idx`. On a table
with only a handful of rows Postgres may legitimately prefer a sequential scan —
if so, record that in the report rather than forcing it; the index is correct
and will be chosen as the table grows.

- [ ] **Step 5: Run the advisors**

```bash
npx supabase db advisors --linked --type all --level info
```

Expected: no new warning attributable to this index.

- [ ] **Step 6: Commit**

```bash
git add supabase/schemas/note_chunks.sql
git commit -m "feat(db): index the embedding queue — partial index on chunks with no vector"
```

---

## Task 7: Wire both triggers

**Files:**
- Modify: `app/notes/actions/transcription.ts`
- Modify: `app/api/cron/transcribe/route.ts`
- Modify: `components/note-detail/__tests__/project-conventions.test.ts`

**Interfaces:**
- Consumes: `createEmbeddingPorts` (Task 5), `embedNoteChunks` (Task 3),
  `embeddingSweep` (Task 4), and the existing `RUN_BUDGET_MS` from
  `lib/transcription/sweep.ts`.
- Produces: nothing new.

**Confirmed against the real files, not the spec.** The `after()` chain in
`app/notes/actions/transcription.ts` is exactly as described: one hoisted
`createDeferredClient(session.access_token)` inside `after()`, then
`transcribeClaimedNote`, then a re-read of the note row, then `claimAndGenerate`.
The embedding call goes after `claimAndGenerate` and reuses `deferred`. The cron
route reads one `startedAt` before phase one and hands
`startedAt + RUN_BUDGET_MS` to phase two; phase three takes the same value.

- [ ] **Step 1: Write the failing guard test**

In `components/note-detail/__tests__/project-conventions.test.ts`, add a new
test after the existing `reads SUPABASE_SECRET_KEY from exactly one shipped
file` block:

```ts
  it("reads VOYAGE_API_KEY from exactly the two shipped triggers", () => {
    // Server-only, exactly like the Gemini key. The embedding pipeline has two
    // entry points and no third: the deferred half of the Transcribe action,
    // and the cron route's third phase. If a client component ever reaches a
    // module that reads this, the key ships to the browser — this is the guard
    // that stops that, and lib/rag/* deliberately reads no env var at all.
    const readers = sourceFiles().filter((f) =>
      read(f).includes("process.env.VOYAGE_API_KEY"),
    );
    expect(readers.sort()).toEqual([
      path.join("app", "api", "cron", "transcribe", "route.ts"),
      path.join("app", "notes", "actions", "transcription.ts"),
    ]);
  });

  it("keeps VOYAGE_API_KEY out of every client component's import graph", () => {
    // A blunt but decisive check: no file that declares "use client" may
    // mention the key, and no file under lib/rag/ may read process.env at all,
    // so a client component cannot reach it transitively through lib/rag.
    const clientFiles = sourceFiles().filter((f) => /^\s*["']use client["']/m.test(read(f)));
    expect(clientFiles.filter((f) => read(f).includes("VOYAGE_API_KEY"))).toEqual([]);

    const ragFiles = sourceFiles().filter((f) => f.startsWith(path.join("lib", "rag")));
    expect(ragFiles.length).toBeGreaterThan(0);
    expect(ragFiles.filter((f) => read(f).includes("process.env"))).toEqual([]);
  });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run components/note-detail/__tests__/project-conventions.test.ts`
Expected: FAIL — `readers` is `[]`, not the two expected paths.

- [ ] **Step 3: Wire the inline trigger**

In `app/notes/actions/transcription.ts`, add to the imports:

```ts
import { embedNoteChunks } from "@/lib/rag/embed-note";
import { createEmbeddingPorts } from "@/lib/rag/supabase-ports";
```

Then, inside the `after(async () => { … })` block, immediately after the
`await claimAndGenerate(...)` call, append:

```ts
      // ---- Embeddings, the third and last deferred phase ------------------
      //
      // ONE call covers BOTH kinds of chunk. By this point transcription has
      // written its transcript_segment rows and note generation has written
      // its summary/takeaway/action_item rows, so "every chunk on this note
      // with no vector" is the complete set. Placing it earlier would embed
      // the transcript and leave the generated chunks to the cron.
      //
      // THE SAME deferred client, never a second one. A second construction
      // would be a second client that can refresh, and a refresh after the
      // response has been sent rotates the user's refresh token into a cookie
      // write that is silently dropped — the bug
      // lib/supabase/deferred-client.ts documents.
      //
      // A missing key SKIPS rather than throws. Embedding is the one phase
      // with a standing backstop: tomorrow's cron sweep is also the backfill,
      // so an unconfigured deployment loses nothing but latency, whereas
      // throwing here would put a red herring in the log for a note that
      // transcribed and generated perfectly well.
      const voyageKey = process.env.VOYAGE_API_KEY;
      if (!voyageKey) {
        console.warn(
          `[embed] note ${noteId}: VOYAGE_API_KEY is not set — leaving the ` +
            `chunks for the cron sweep, which is also the backfill.`,
        );
        return;
      }

      const embedded = await embedNoteChunks(
        createEmbeddingPorts(deferred, voyageKey),
        noteId,
      );
      console.log(`[embed] note ${noteId}: ${JSON.stringify(embedded)}`);
```

Also extend the block comment at the top of `triggerTranscription` — after the
`NOTE GENERATION CHAINS HERE` paragraph, add:

```
 * EMBEDDINGS CHAIN AFTER THAT, added 2026-09-03, on the same client again.
 * One call, once both chunk kinds exist. It takes no claim: the per-chunk
 * guarded UPDATE in lib/rag/supabase-ports.ts makes a race with the cron sweep
 * cost a duplicate Voyage call and never a duplicate write, and a Voyage call
 * is a rounding error where a Gemini one is not.
```

- [ ] **Step 4: Wire the cron trigger**

In `app/api/cron/transcribe/route.ts`, add to the imports:

```ts
import { createEmbeddingPorts } from "@/lib/rag/supabase-ports";
import { embeddingSweep } from "@/lib/rag/sweep";
```

Replace the `return Response.json({ ...report, notegen });` line and the block
above it with:

```ts
    // Phase three, on the remainder of the SAME budget. ONE clock, THREE
    // phases now — the route still reads a single startedAt and every phase is
    // handed the same deadline rather than starting its own. Embedding runs
    // last on purpose: it is the only phase with a standing backstop, since
    // this same sweep is also the backfill, so a busy run deferring it costs
    // nothing but a day.
    const voyageKey = process.env.VOYAGE_API_KEY;
    let embeddings: unknown = { skipped: "VOYAGE_API_KEY is not set" };

    if (voyageKey) {
      embeddings = await embeddingSweep(createEmbeddingPorts(db, voyageKey), {
        deadlineAt: startedAt + RUN_BUDGET_MS,
      });
    } else {
      // Loud, but not fatal. Transcription and note generation have already
      // run and their results must still be returned; failing the whole route
      // over an unset embedding key would throw away real work.
      console.error(`[embed] skipped: VOYAGE_API_KEY is not set`);
    }
    console.log(`[embed] ${JSON.stringify(embeddings)}`);

    return Response.json({ ...report, notegen, embeddings });
```

Also extend the route's block comment — after the `TWO PHASES ON ONE CLOCK`
paragraph, add:

```
 *  THREE PHASES ON ONE CLOCK, from 2026-09-03. Embedding population sweeps
 *  last, over every chunk in the table that still has no vector, for every
 *  user — which makes this phase the BACKFILL as well as the backstop. It
 *  takes the same startedAt + RUN_BUDGET_MS deadline as phase two rather than
 *  a third budget of its own, and its own MAX_EMBED_NOTES_PER_RUN cap bounds
 *  cost. An unset VOYAGE_API_KEY skips this phase and is reported in the
 *  response body; it does not fail a run whose first two phases succeeded.
```

- [ ] **Step 5: Run the guard test and the full suite**

```bash
npx vitest run components/note-detail/__tests__/project-conventions.test.ts
npx tsc --noEmit
npx vitest run
```

Expected: all pass. The 400-line ceiling test covers the two modified `app/`
files — if either crossed it, extract rather than raise the ceiling.

- [ ] **Step 6: Commit**

```bash
git add app/notes/actions/transcription.ts app/api/cron/transcribe/route.ts components/note-detail/__tests__/project-conventions.test.ts
git commit -m "feat(rag): trigger embedding inline after notegen and as cron phase three"
```

---

## Task 8: The live proof script

**Files:**
- Create: `scripts/verify-embeddings-pipeline.mjs`

**Interfaces:**
- Consumes: the shipped `lib/rag/*` modules, imported through the same Node
  resolve-hook trick `scripts/verify-notegen-pipeline.mjs` uses.
- Produces: an exit code and a printed report.

**Prerequisite — the owner must add `VOYAGE_API_KEY` to `.env.local`.** It is
not there today (checked 2026-09-03: the file holds `CRON_SECRET`,
`GEMINI_API_KEY`, `NEXT_PUBLIC_SUPABASE_*`, `RLS_TEST_*` and
`SUPABASE_SECRET_KEY`). The script must fail with that exact instruction rather
than a confusing 401.

**Six proofs:**

1. **Semantic sanity.** Embed two similar sentences and one unrelated one.
   Assert cosine similarity ranks the similar pair closer. *This is the proof
   that the pipeline is useful rather than merely writing bytes.*
2. **A note's chunks get real vectors**, in exactly one Voyage call, and the
   vector read back from Postgres is 1024-wide.
3. **A fully embedded table costs zero Voyage calls.** Re-running against the
   same note calls Voyage zero times, matching how the notegen script proves
   its own claim guard.
4. **Backfill.** Count rows with `embedding is null` before and after a sweep
   run, and show the count fall.
5. **The poison chunk stops after three attempts** — attempts read 1, 2, 3 on
   consecutive runs, and on the fourth the chunk is no longer listed as
   pending, with no Voyage call spent on it.
6. **The healthy sibling in that same note is NOT blocked** — it is embedded on
   the very first run, and its metadata carries no `embed_attempts`.

- [ ] **Step 1: Write the script**

Create `scripts/verify-embeddings-pipeline.mjs`:

```js
/**
 * Live proof of the EMBEDDINGS POPULATION PIPELINE against the hosted project
 * and the real Voyage API.
 *
 * It imports the SHIPPED modules rather than re-implementing them:
 *
 *     lib/rag/embed-note.ts       embedChunks, embedNoteChunks
 *     lib/rag/sweep.ts            embeddingSweep, MAX_EMBED_ATTEMPTS
 *     lib/rag/supabase-ports.ts   createEmbeddingPorts
 *     lib/rag/voyage-client.ts    createVoyageEmbedder
 *
 * Node 24 strips TypeScript natively and the resolve hook below maps this
 * project's "@/" alias onto the repo root, so the import is the real module —
 * a copy here would only prove that the copy agrees with itself.
 *
 * ports.embed is wrapped in a COUNTER. "Zero Voyage calls on a fully embedded
 * table" and "no call spent on an exhausted chunk" are therefore MEASURED, not
 * asserted.
 *
 * NO DEV SERVER NEEDED. Runs against the authenticated (RLS) client throughout,
 * which is what the Server Action uses, and deletes its rows as the OWNER in
 * the finally block — exercising the RLS path a real user takes. note_chunks
 * cascade from notes.id.
 *
 *   node scripts/verify-embeddings-pipeline.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = pathToFileURL(resolve(import.meta.dirname, "..") + "/").href;

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (specifier.startsWith("@/")) {
        return next(new URL(specifier.slice(2) + ".ts", ${JSON.stringify(ROOT)}).href, context);
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);

const { createEmbeddingPorts } = await import(
  new URL("lib/rag/supabase-ports.ts", ROOT).href
);
const { embedChunks, embedNoteChunks } = await import(
  new URL("lib/rag/embed-note.ts", ROOT).href
);
const { embeddingSweep, MAX_EMBED_ATTEMPTS, EMBED_CHUNK_WINDOW } = await import(
  new URL("lib/rag/sweep.ts", ROOT).href
);
const { createVoyageEmbedder, VOYAGE_OUTPUT_DIMENSION } = await import(
  new URL("lib/rag/voyage-client.ts", ROOT).href
);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function loadEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

function roleClaim(jwt) {
  return JSON.parse(
    Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"),
  ).role;
}

let failed = false;
function check(label, ok, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed = true;
}

/** pgvector hands a vector back as its text form, "[0.1,0.2,…]". */
function parseVector(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  return JSON.parse(value);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const env = loadEnv(".env.local");

for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "RLS_TEST_OWNER_EMAIL",
  "RLS_TEST_OWNER_PASSWORD",
]) {
  if (!env[name]) throw new Error(`${name} is missing from .env.local`);
}

if (!env.VOYAGE_API_KEY) {
  throw new Error(
    "VOYAGE_API_KEY is missing from .env.local. Add it (server-only, never " +
      "NEXT_PUBLIC_) and re-run — this script spends real Voyage quota and " +
      "cannot prove anything without it.",
  );
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const anon = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
  email: env.RLS_TEST_OWNER_EMAIL,
  password: env.RLS_TEST_OWNER_PASSWORD,
});
if (signInError) throw signInError;

const token = signIn.session.access_token;
const role = roleClaim(token);
if (role !== "authenticated") {
  throw new Error(
    `refusing to trust a result from role "${role}" — the inline trigger runs ` +
      `as the signed-in user, so the proof requires the authenticated role`,
  );
}

const owner = createClient(url, publishableKey, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

const userId = signIn.user.id;

// The counter is the whole cost proof.
const realPorts = createEmbeddingPorts(owner, env.VOYAGE_API_KEY);
let voyageCalls = 0;
const ports = {
  ...realPorts,
  embed: async (texts) => {
    voyageCalls += 1;
    return realPorts.embed(texts);
  },
};

const created = [];

async function seedNote(title) {
  const { data, error } = await owner
    .from("notes")
    .insert({
      user_id: userId,
      title,
      processing_status: "completed",
      raw_transcript: "seeded by verify-embeddings-pipeline",
      notegen_status: "completed",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seeding "${title}" failed: ${error.message}`);
  created.push(data.id);
  return data.id;
}

async function seedChunk(noteId, content, metadata = {}) {
  const { data, error } = await owner
    .from("note_chunks")
    .insert({
      note_id: noteId,
      user_id: userId,
      chunk_type: "transcript_segment",
      persona_id: null,
      content,
      embedding: null,
      metadata,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seeding a chunk failed: ${error.message}`);
  return data.id;
}

async function chunkRow(id) {
  const { data, error } = await owner
    .from("note_chunks")
    .select("id, content, embedding, metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`reading chunk ${id} failed: ${error.message}`);
  return data;
}

async function pendingCount() {
  const { count, error } = await owner
    .from("note_chunks")
    .select("id", { count: "exact", head: true })
    .is("embedding", null);
  if (error) throw new Error(`counting pending chunks failed: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

try {
  console.log(`\nsigned in as ${env.RLS_TEST_OWNER_EMAIL} (role ${role})`);
  console.log(`user_id ${userId}\n`);

  // ---- Proof 1 -------------------------------------------------------------
  console.log("Proof 1 — semantic sanity: similar text ranks closer than unrelated");
  const raw = createVoyageEmbedder(env.VOYAGE_API_KEY);
  const [anchor, similar, unrelated] = await raw([
    "The team agreed to ship the mapping work before the billing migration.",
    "We decided mapping goes out first and billing waits until it is green.",
    "The kitchen tap has been dripping since Tuesday and needs a new washer.",
  ]);

  const near = cosine(anchor, similar);
  const far = cosine(anchor, unrelated);
  console.log(`  cosine(anchor, similar)   = ${near.toFixed(4)}`);
  console.log(`  cosine(anchor, unrelated) = ${far.toFixed(4)}`);
  check("the similar pair ranks closer", near > far, `(${(near - far).toFixed(4)} apart)`);
  check("vectors are the pinned width", anchor.length === VOYAGE_OUTPUT_DIMENSION, `(${anchor.length})`);

  // ---- Proof 2 -------------------------------------------------------------
  console.log("\nProof 2 — a note's chunks get real vectors, in one Voyage call");
  const note1 = await seedNote("embeddings proof 1");
  const c1 = await seedChunk(note1, "Mapping ships before the billing migration.", { seq: 0, ts_start: "00:00" });
  const c2 = await seedChunk(note1, "Ravi circulates the sequencing plan on Thursday.", { seq: 1, ts_start: "00:12" });

  const before2 = voyageCalls;
  const report2 = await embedNoteChunks(ports, note1);
  console.log(`  report: ${JSON.stringify(report2)}`);

  check("both chunks embedded", report2.embedded === 2, `(${report2.embedded})`);
  check("exactly one Voyage call", voyageCalls - before2 === 1, `(${voyageCalls - before2})`);

  const stored = parseVector((await chunkRow(c1)).embedding);
  check("the stored vector is 1024-wide", stored?.length === VOYAGE_OUTPUT_DIMENSION, `(${stored?.length})`);
  check("the stored vector is not all zeroes", stored?.some((v) => v !== 0));

  const kept = (await chunkRow(c2)).metadata;
  check("the chunk's own metadata survived", kept.seq === 1 && kept.ts_start === "00:12", JSON.stringify(kept));

  // ---- Proof 3 -------------------------------------------------------------
  console.log("\nProof 3 — a fully embedded note costs zero Voyage calls");
  const before3 = voyageCalls;
  const report3 = await embedNoteChunks(ports, note1);
  check("nothing left to embed", report3.embedded === 0, JSON.stringify(report3));
  check("no Voyage call", voyageCalls - before3 === 0, `(${voyageCalls - before3})`);

  // ---- Proof 4 -------------------------------------------------------------
  console.log("\nProof 4 — the sweep backfills chunks the inline path never saw");
  const note2 = await seedNote("embeddings proof 4 (backfill)");
  await seedChunk(note2, "Priya flagged that the old customer IDs must survive.");
  await seedChunk(note2, "Dana asked for the assumption to be written down.");

  const pendingBefore = await pendingCount();
  const before4 = voyageCalls;
  const report4 = await embeddingSweep(ports, { deadlineAt: Date.now() + 120_000 });
  const pendingAfter = await pendingCount();

  console.log(`  sweep report: ${JSON.stringify(report4)}`);
  console.log(`  rows with embedding IS NULL: ${pendingBefore} before -> ${pendingAfter} after`);
  check("the sweep embedded the backlog", report4.embedded >= 2, `(${report4.embedded})`);
  check("the pending count fell", pendingAfter < pendingBefore, `(${pendingBefore} -> ${pendingAfter})`);
  check("it spent at least one call", voyageCalls - before4 >= 1, `(${voyageCalls - before4})`);

  // ---- Proofs 5 and 6 ------------------------------------------------------
  console.log(`\nProofs 5 & 6 — a poison chunk gives up after ${MAX_EMBED_ATTEMPTS}, its sibling does not wait`);
  const note3 = await seedNote("embeddings proof 5 (poison)");
  const poison = await seedChunk(note3, "POISON: this chunk always fails to embed.", { seq: 0 });
  const sibling = await seedChunk(note3, "A perfectly healthy sibling chunk in the same note.", { seq: 1 });

  // The failure is INJECTED at the client boundary, which is the honest way to
  // force one: nothing in real content reliably makes Voyage return a 400, and
  // asserting the cap without exercising it would prove nothing. Everything
  // else below the injection is the shipped code.
  const { VoyageError } = await import(new URL("lib/rag/voyage-client.ts", ROOT).href);
  const poisonPorts = {
    ...realPorts,
    embed: async (texts) => {
      voyageCalls += 1;
      if (texts.some((t) => t.startsWith("POISON:"))) {
        throw new VoyageError("injected 400 for the poison chunk", "content", 400);
      }
      return realPorts.embed(texts);
    },
  };

  for (let attempt = 1; attempt <= MAX_EMBED_ATTEMPTS; attempt += 1) {
    const pending = await realPorts.listPendingForNote(note3, EMBED_CHUNK_WINDOW);
    const run = await embedChunks(poisonPorts, pending);
    const row = await chunkRow(poison);
    console.log(
      `  run ${attempt}: listed=${pending.length} embed_attempts=${row.metadata.embed_attempts} ` +
        `report=${JSON.stringify(run)}`,
    );
    check(`run ${attempt} records attempt ${attempt}`, row.metadata.embed_attempts === attempt);

    if (attempt === 1) {
      const sib = await chunkRow(sibling);
      check(
        "PROOF 6: the healthy sibling embedded on the FIRST run",
        parseVector(sib.embedding)?.length === VOYAGE_OUTPUT_DIMENSION,
      );
      check(
        "PROOF 6: the sibling was never charged an attempt",
        sib.metadata.embed_attempts === undefined,
        JSON.stringify(sib.metadata),
      );
    }
  }

  const afterCap = await realPorts.listPendingForNote(note3, EMBED_CHUNK_WINDOW);
  check(
    `PROOF 5: the exhausted chunk is no longer listed as pending`,
    afterCap.every((c) => c.id !== poison),
    `(${afterCap.length} still pending in this note)`,
  );

  const before7 = voyageCalls;
  const afterReport = await embedNoteChunks(poisonPorts, note3);
  check(
    "PROOF 5: a further run spends no Voyage call on it",
    voyageCalls - before7 === 0,
    `(${voyageCalls - before7}, report ${JSON.stringify(afterReport)})`,
  );

  const finalPoison = await chunkRow(poison);
  check("PROOF 5: its embedding is still null", finalPoison.embedding === null);
  check(
    "PROOF 5: its metadata records the reason",
    typeof finalPoison.metadata.embed_error === "string",
    finalPoison.metadata.embed_error,
  );
  check("PROOF 5: its own seq survived the merges", finalPoison.metadata.seq === 0);

  console.log(`\ntotal Voyage calls across all proofs: ${voyageCalls}`);
} finally {
  for (const id of created) {
    const { error } = await owner.from("notes").delete().eq("id", id);
    if (error) console.error(`  cleanup: could not delete ${id}: ${error.message}`);
  }
  console.log(`cleaned up ${created.length} note row(s) as the owner`);
}

console.log(failed ? "\nFAILED\n" : "\nPASSED\n");
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Ask the owner to add `VOYAGE_API_KEY` to `.env.local`**

Do not attempt to obtain, generate or write the key. State plainly that the
line `VOYAGE_API_KEY=...` must be added to the gitignored `.env.local` and that
the proof cannot run until it is.

- [ ] **Step 3: Run it and paste the full output**

```bash
node scripts/verify-embeddings-pipeline.mjs
```

Expected: `PASSED`, with the Voyage call count, the before/after pending count,
and the two cosine numbers all printed.

If Proof 2 fails with a pgvector type error, the string form in
`writeEmbedding` is wrong — change it to `update({ embedding: vector })`,
update the assertion in `lib/rag/__tests__/supabase-ports.test.ts` to match,
and re-run both.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-embeddings-pipeline.mjs
git commit -m "test(rag): live six-proof verification of the embeddings pipeline"
```

---

## Task 9: Documentation and final verification

**Files:**
- Modify: `docs/KNOWN_GAPS.md`
- Modify: `docs/DECISIONS.md`
- Modify: `CLAUDE.md`

**Interfaces:** none.

- [ ] **Step 1: Close the open embeddings paragraph in `docs/KNOWN_GAPS.md`**

Replace the paragraph beginning `**Embeddings — still open, unchanged.**`
(inside `### No structured note generation and no embeddings`) with:

```markdown
**Embeddings — CLOSED 2026-09-03.** `note_chunks.embedding` is populated. The
chunk's own `embedding IS NULL` is the queue — no new status column, no job
table, the same "a row's own state is the queue" rule as `processing_status`
and `notegen_status`, at chunk grain. `lib/rag/*` batches a note's pending
chunks through Voyage `voyage-4` (`input_type: "document"`,
`output_dimension: 1024`, `output_dtype: "float"`, all pinned) and writes each
vector back under a per-row guarded `UPDATE ... WHERE id = $1 AND embedding IS
NULL`. Two triggers: the end of the existing `after()` chain in
`app/notes/actions/transcription.ts`, and phase three of
`app/api/cron/transcribe/route.ts`, which is also the backfill for every chunk
written before this shipped. The hnsw index over the column is no longer empty.
**No retrieval path reads it yet** — hybrid vector + full-text search via
reciprocal rank fusion is still a Core UX/UI item in `docs/ROADMAP.md` §4, and
that is what the embeddings now exist for.
```

- [ ] **Step 2: Add the new gap entry**

Append a new `###` section to `docs/KNOWN_GAPS.md`, immediately after the
section edited above:

```markdown
### An unembeddable chunk gives up silently, and nothing says so

**Opened 2026-09-03, with the embeddings pipeline.**

A chunk that fails to embed three times is left with `embedding` null
permanently. `lib/rag/embed-note.ts` counts the attempts in
`note_chunks.metadata.embed_attempts` and the eligibility filter in
`lib/rag/supabase-ports.ts` stops listing it at three, so it is never retried
again — by the inline trigger or by the cron sweep.

**Nothing reports this.** There is no error column at single-owner scale
(§ Transcription made that choice and this pipeline follows it), so the only
trace is one `[embed]` line in the Vercel function log at the moment the third
attempt fails, and `metadata.embed_error` on the row itself. The log rotates.
Nobody is paged, no dashboard turns red, and the note renders completely
normally — the chunk is simply invisible to a retrieval path that does not
exist yet.

The failure is therefore **silent and permanent**, and it will only be
discovered when hybrid retrieval ships and somebody notices a specific
takeaway is never returned. The cap itself is right: three attempts on a chunk
that Voyage rejects for its content is enough, and retrying forever would spend
real money on a text that will never embed. Transient failures — rate limits,
5xx, network — deliberately do **not** increment the counter, so this only ever
catches genuinely unembeddable content.

**The measurement that would close it** is one query, which nothing runs today:

```sql
select id, note_id, metadata->>'embed_error' as reason
from public.note_chunks
where embedding is null and (metadata->>'embed_attempts')::int >= 3;
```

The honest options are (a) surface that count in the cron route's JSON response
so a failing run is visible where the sweep report already is, (b) add the
error column this project has twice decided not to add, or (c) accept it until
retrieval ships and the absence becomes visible on its own. **(c) is what is
accepted today**, deliberately, because at one user with a handful of notes the
query above is a thirty-second manual check and the pipeline has no
observability budget of its own. Revisit at the same moment hybrid retrieval
lands — that is when a missing chunk starts to cost an answer.
```

- [ ] **Step 3: Add the `docs/DECISIONS.md` bullet**

In `docs/DECISIONS.md`, at the end of the `**RAG**` bullet list (immediately
after the `- Embedding vendor: **Voyage AI ...**` line and before the
`**Cost — validated against real usage...**` heading), add:

```markdown
- **Embedding population — shipped 2026-09-03.** `note_chunks.embedding IS
  NULL` **is** the queue: no new status column and no job table, the same
  "a row's own state is the queue" rule as `processing_status` and
  `notegen_status`, applied at chunk grain because embeddings are per chunk,
  not per note. A retry cap of **3** is tracked in the existing
  `note_chunks.metadata` jsonb, **merged into it, never written over it** — a
  `transcript_segment` row already carries `speaker`, `ts_start`, `ts_end` and
  `seq` there. Embedding is triggered **once at the end of the existing
  transcription → notegen `after()` chain** (by which point both chunk kinds
  exist, so one call covers both), plus a **daily cron sweep sharing the run's
  single `startedAt`-derived deadline** — three phases, one clock — which
  doubles as the **backfill** for every chunk written before this shipped.
  Chunks are **batched per note through Voyage in one call**, with
  `input_type: "document"` (the asymmetric mode for stored content — the
  retrieval side owes `"query"` on the question), a pinned
  `output_dimension: 1024` and `output_dtype: "float"` on every call, since the
  column is a fixed `vector(1024)` and an API default could move. On a batch
  failure each chunk is **retried individually**, so one poison chunk cannot
  cost its siblings their attempt; only a chunk that fails **on its own**
  increments the counter, and only a content error does — a 429/5xx leaves the
  row eligible, and a 401/403 aborts the run rather than burning every chunk's
  attempts. **The inline path and the sweep are allowed to race.** This is a
  deliberate deviation from the claim-before-spend pattern transcription and
  note generation use: a race here costs a **duplicate Voyage call, never a
  duplicate write**, because the per-row `UPDATE ... WHERE id = $1 AND
  embedding IS NULL` guard is atomic — and a Voyage call at $0.06/1M tokens is
  a rounding error where a Gemini transcription call is not. Adding a
  note-level lock would buy nothing and add a second mechanism to get wrong.
```

- [ ] **Step 3b: Correct the superseded vendor line in both planning docs**

The model swap makes two existing lines wrong. Fix them in place rather than
letting the new bullet contradict them.

In `docs/DECISIONS.md`, replace:

```markdown
- Embedding vendor: **Voyage AI `voyage-3-large`, confirmed** (was the open
  item, now closed).
```

with:

```markdown
- Embedding vendor: **Voyage AI `voyage-4`, confirmed.** This line read
  `voyage-3-large` until 2026-09-03 and was changed on cost, measured against
  docs.voyageai.com/docs/pricing that day: `voyage-3-large` is now Voyage's
  legacy tier at **$0.18/M tokens with no free allowance**, `voyage-4` is
  current-generation at **$0.06/M with 200 million free tokens per account**.
  $0.06/M is the number ROADMAP.md §3 already quoted, so the cost modelling
  below never needed revising — only the model name was stale. Everything this
  project depends on is identical across the two: 1024 default dimension (also
  2048/512/256), the same five output dtypes, 32,000-token context. The one
  real difference is the per-request cap, **320,000 tokens for `voyage-4`**
  against 120,000, which only widens the batching headroom.
```

In `docs/ROADMAP.md` §3, replace `Voyage AI (\`voyage-3-large\`) —
**confirmed**` in the RAG embeddings table row with ``Voyage AI (`voyage-4`) —
**confirmed**``. The `$0.06/1M, 32K context` figures in that same row are
already correct for `voyage-4` and need no change — which is the evidence the
name, not the costing, was what drifted.

Leave `docs/superpowers/plans/2026-08-30-supabase-persistence.md` alone. It is
a record of what was decided then, not a live claim.

- [ ] **Step 4: Add the `CLAUDE.md` section**

Insert a new `## Embeddings` section immediately after the `## Note generation`
section and before `## Naming`:

```markdown
## Embeddings

**`note_chunks.embedding IS NULL` IS the queue**, the same rule as
`processing_status` and `notegen_status` — at **chunk** grain, because
embeddings are per chunk, not per note. There is no new status column and no
job table. `lib/rag/sweep.ts` owns this column and nothing else; do not edit
`lib/transcription/sweep.ts` or `lib/notegen/sweep.ts` to handle it.

**There is deliberately NO claim.** The inline trigger and the cron sweep may
both reach one note, and the loser costs a duplicate **Voyage call**, never a
duplicate **write** — the per-row guard
`update(embedding) ... eq(id) ... is(embedding, null)` in
`lib/rag/supabase-ports.ts` is atomic. That is the whole difference from the
other two pipelines: their claim exists because a lost race would cost a Gemini
call. At $0.06/1M tokens a Voyage call is a rounding error. **Do not add a
note-level lock.**

Vendor specifics, all read from the live docs on 2026-09-03, never from memory:

- `POST https://api.voyageai.com/v1/embeddings`, `Authorization: Bearer`.
- **`input_type` is always `"document"`.** Voyage is asymmetric; the retrieval
  side owes `"query"` on the question. Sending the wrong one degrades ranking
  silently rather than erroring.
- **`output_dimension: 1024` and `output_dtype: "float"` are PINNED on every
  call.** The column is a fixed `extensions.vector(1024)`. `voyage-4`
  also offers 2048/512/256 and five dtypes; a moved default would start writing
  vectors the column refuses, or integers it silently accepts as nonsense.
- Caps: **1,000 texts and 320,000 tokens per request**; `VOYAGE_MAX_BATCH_TEXTS`
  is 128 and `VOYAGE_MAX_BATCH_TOKENS` 100,000, both well under. Rate limit is
  2,000 RPM / 8,000,000 TPM at tier 1, which this volume cannot approach.
- The vector crosses PostgREST as `JSON.stringify(vector)` — pgvector's own
  text input format. A raw array serialises as a JSON array, a different type.

**Only a chunk that fails ON ITS OWN is charged an attempt.** A failed batch is
retried one chunk at a time precisely so one poison chunk cannot spend its
siblings' attempts. A `429`/`5xx`/network failure is transient and increments
nothing; a `401`/`403` aborts the run rather than burning every chunk's counter;
only a `400`/`422` counts. Three charged attempts and the chunk is left null
permanently — a real gap, recorded in `docs/KNOWN_GAPS.md` § "An unembeddable
chunk gives up silently".

Attempts live in `note_chunks.metadata`, **merged, never overwritten** — a
`transcript_segment` row carries `speaker`, `ts_start`, `ts_end` and `seq` in
that same object. PostgREST cannot send `metadata || jsonb_build_object(...)`,
so `withEmbedAttempt()` merges the object the listing query already returned and
the guarded UPDATE writes the merged whole.

The eligibility filter enumerates attempt values (`in.(0,1,2)`) rather than
comparing them. PostgREST reads `metadata->>embed_attempts` as **text**, so
`lt.3` would be a lexicographic comparison — right for one digit, wrong the
moment the cap reaches ten. The list is generated from `MAX_EMBED_ATTEMPTS`.

**Blank content is terminal, not skipped.** A whitespace chunk is taken straight
to the attempt cap with no Voyage call. Skipping would leave it eligible
forever and a handful could starve real work out of the per-run cap — the same
reasoning as note generation's blank-transcript guard.

`VOYAGE_API_KEY` is **server-only** and read in exactly two shipped files —
`app/notes/actions/transcription.ts` and `app/api/cron/transcribe/route.ts`.
`lib/rag/*` reads no environment variable at all; the caller supplies the key,
which is what keeps it out of every client component's import graph.
`project-conventions.test.ts` fails the build if either stops being true. An
unset key **skips** rather than throws in both places: the cron sweep is also
the backfill, so nothing is lost but latency.

**Three phases, one clock.** The cron route reads one `startedAt` and hands
`startedAt + RUN_BUDGET_MS` to phase two and phase three alike. Embedding runs
last because it is the only phase with a standing backstop.
`MAX_EMBED_NOTES_PER_RUN = 10` bounds cost; the shared budget bounds wall-clock.
The cap counts **notes**, because a note is the batching unit, and it is sized
against the write-back — one guarded UPDATE per chunk — not against the Voyage
call, which is fast.

    node scripts/verify-embeddings-pipeline.mjs   # no dev server needed:
                                                  # six proofs, Voyage calls
                                                  # counted, cosine ranking
                                                  # measured, the 3-attempt cap
                                                  # exercised with a healthy
                                                  # sibling alongside it
```

Then update the file's header line to `**Last updated:** 2026-09-03` (it may
already read that; confirm rather than assume), and add `VOYAGE_API_KEY` to
the § Supabase → Keys discussion only if that section enumerates non-Supabase
keys — it does not today, so leave it alone.

- [ ] **Step 5: Full verification**

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: all three clean. Paste each result in the report.

- [ ] **Step 6: Prove the key is unreachable from client code**

```bash
grep -rn "VOYAGE_API_KEY" --include=*.ts --include=*.tsx app lib components
grep -rln "use client" components lib app | xargs grep -ln "VOYAGE" || echo "no client file mentions VOYAGE"
```

Expected: the first prints exactly two `app/` files; the second prints the
"no client file mentions VOYAGE" fallback. Paste both outputs verbatim.

- [ ] **Step 7: Commit**

```bash
git add docs/KNOWN_GAPS.md docs/DECISIONS.md CLAUDE.md
git commit -m "docs: close the embeddings gap, record the queue design and the accepted silent-failure gap"
```

---

## After the plan

1. **REQUIRED SUB-SKILL:** `superpowers:requesting-code-review` once every task
   is done and all three commands are green.
2. **REQUIRED SUB-SKILL:** `superpowers:finishing-a-development-branch` to
   decide how this integrates.
3. Report to the owner per the reporting contract: what shipped, what was
   skipped, the exact Voyage batch size, any rate limit designed around, and
   the per-run cap and deadline share chosen — plus the three pasted doc
   changes and the full verify-script output.

## Self-review notes

- **Spec coverage:** Voyage client (Task 1) · batched per-note embed with
  guarded per-row write (Tasks 3, 5) · `input_type: "document"` recorded in
  DECISIONS (Task 9) · pinned 1024/float (Task 1) · individual retry on batch
  failure (Task 3) · attempt cap in metadata, merged (Tasks 2, 3, 5) ·
  KNOWN_GAPS entry for the silent failure (Task 9) · one integration point at
  the end of the `after()` chain reusing the hoisted client (Task 7) ·
  `lib/rag/sweep.ts` as a new file (Task 4) · cron phase three sharing the
  deadline with its own cap (Tasks 4, 7) · partial index via the declarative
  workflow (Task 6) · verify script with call count, backfill count and
  similarity ranking (Task 8) · server-only key check (Tasks 7, 9) ·
  three-strikes proof with an unblocked sibling (Task 8). All covered.
- **Known open question for the owner:** `VOYAGE_API_KEY` is not in
  `.env.local`. Task 8 cannot run until it is added. Every other task is
  unblocked.
