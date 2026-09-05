// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/** Set and unset key by key, NEVER `process.env = {...}`.
 *
 *  MEASURED: assigning to `process.env` swaps Node's native env object for a
 *  plain one. It stops coercing values to strings (`process.env.N = 5` then
 *  reads back as a number), and the swap is process-wide and permanent. Vitest
 *  reuses a worker process across test files, so one such assignment leaves
 *  every later file in that worker reading a detached copy of the environment.
 *  vi.stubEnv/unstubAllEnvs restores in place and has neither problem. */
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  vi.stubEnv("CRON_SECRET", "the-real-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function get(headers: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/cron/transcribe/route");
  return GET(
    new Request("https://example.test/api/cron/transcribe", { headers }),
  );
}

describe("GET /api/cron/transcribe — the CRON_SECRET gate", () => {
  it("rejects a request with no Authorization header", async () => {
    expect((await get()).status).toBe(401);
  });

  it("rejects a wrong secret", async () => {
    expect((await get({ authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("rejects the right secret without the Bearer prefix", async () => {
    // Vercel always sends "Bearer <value>". Accepting the bare value would
    // widen the gate for no reason.
    expect((await get({ authorization: "the-real-secret" })).status).toBe(401);
  });

  it("refuses every request when CRON_SECRET is unset, rather than opening up", async () => {
    delete process.env.CRON_SECRET;
    expect((await get({ authorization: "Bearer anything" })).status).toBe(401);
    expect((await get()).status).toBe(401);
  });

  it("never constructs a Gemini client for an unauthorized request", async () => {
    // The whole point of the gate: an unauthenticated caller must not be able
    // to spend the API key.
    const genai = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI: genai }));

    await get({ authorization: "Bearer wrong" });

    expect(genai).not.toHaveBeenCalled();
  });
});

/** The stuck-chunk surfacing, added 2026-09-05.
 *
 *  The contract has two halves and both matter. A healthy run's body must be
 *  BYTE-for-byte what it was before this shipped — the key appearing at all is
 *  the signal, so a `stuckChunks: { count: 0 }` on every run would train the
 *  reader to ignore it. And a run with stuck chunks must carry the ids, not
 *  just a number, because the whole point is being able to go and look. */
describe("GET /api/cron/transcribe — stuck-chunk surfacing", () => {
  function mockDeps(
    result: { data?: unknown[]; count?: number; error?: { message: string } },
    options: { throws?: boolean } = {},
  ) {
    const resolved = {
      data: result.data ?? [],
      count: result.count ?? (result.data ?? []).length,
      error: result.error ?? null,
    };
    const builder = {
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      // Real methods, so "was never called" is an assertion about the ROUTE
      // rather than about the fixture's incompleteness.
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      limit: options.throws
        ? vi.fn().mockRejectedValue(new Error("fetch failed"))
        : vi.fn().mockResolvedValue(resolved),
    };
    const from = vi.fn(() => builder);

    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({ from }),
    }));
    vi.doMock("@/lib/transcription/supabase-ports", () => ({
      createTranscriptionPorts: () => ({}),
    }));
    vi.doMock("@/lib/notegen/notegen-ports", () => ({
      createNotegenPorts: () => ({}),
    }));
    vi.doMock("@/lib/rag/supabase-ports", () => ({
      createEmbeddingPorts: () => ({}),
    }));
    vi.doMock("@/lib/transcription/sweep", () => ({
      RUN_BUDGET_MS: 240_000,
      sweep: async () => ({ transcribed: 0 }),
    }));
    vi.doMock("@/lib/notegen/sweep", () => ({
      notegenSweep: async () => ({ generated: 0 }),
    }));
    // NOT mocked away: the real MAX_EMBED_ATTEMPTS, so the filter assertion
    // below is against the shipped cap rather than against itself.
    vi.doMock("@/lib/rag/sweep", async () => ({
      ...(await vi.importActual("@/lib/rag/sweep")),
      embeddingSweep: async () => ({ embedded: 0 }),
    }));
    return builder;
  }

  const ok = { authorization: "Bearer the-real-secret" };

  it("leaves the body's shape unchanged when nothing is stuck", async () => {
    mockDeps({ data: [] });
    const body = await (await get(ok)).json();

    expect(body).toEqual({
      transcribed: 0,
      notegen: { generated: 0 },
      embeddings: { skipped: "VOYAGE_API_KEY is not set" },
    });
    expect("stuckChunks" in body).toBe(false);
  });

  it("reports the count AND the ids when chunks have given up", async () => {
    mockDeps({
      data: [
        { id: "chunk-1", note_id: "note-1", reason: "400 invalid input" },
        { id: "chunk-2", note_id: "note-1", reason: null },
      ],
    });
    const body = await (await get(ok)).json();

    expect(body.stuckChunks).toEqual({
      count: 2,
      chunks: [
        { id: "chunk-1", note_id: "note-1", reason: "400 invalid input" },
        { id: "chunk-2", note_id: "note-1", reason: null },
      ],
    });
  });

  it("reports the EXACT count even when the row sample is bounded", async () => {
    // config.toml caps a page at 1,000 rows and the route asks for 50. A count
    // taken from data.length would report the sample size as the measurement.
    mockDeps({
      data: [{ id: "chunk-1", note_id: "note-1", reason: "400" }],
      count: 412,
    });
    const body = await (await get(ok)).json();

    expect(body.stuckChunks.count).toBe(412);
    expect(body.stuckChunks.chunks).toHaveLength(1);
  });

  it("asks for embedding IS NULL at exactly the SHIPPED attempt cap, as TEXT", async () => {
    // gte would be a lexicographic comparison on a text-typed json field.
    const builder = mockDeps({ data: [] });
    const { MAX_EMBED_ATTEMPTS } = await import("@/lib/rag/sweep");
    await get(ok);

    expect(builder.is).toHaveBeenCalledWith("embedding", null);
    expect(builder.eq).toHaveBeenCalledWith(
      "metadata->>embed_attempts",
      String(MAX_EMBED_ATTEMPTS),
    );
    expect(builder.limit).toHaveBeenCalledWith(50);
  });

  it("never writes: the surfacing is read-only", async () => {
    const builder = mockDeps({ data: [] });
    await get(ok);

    expect(builder.update).not.toHaveBeenCalled();
    expect(builder.insert).not.toHaveBeenCalled();
    expect(builder.delete).not.toHaveBeenCalled();
  });

  it("keeps the run's report when the count query returns an error", async () => {
    mockDeps({ error: { message: "boom" } });
    const response = await get(ok);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.transcribed).toBe(0);
    expect("stuckChunks" in body).toBe(false);
  });

  it("keeps the run's report when the count query THROWS", async () => {
    // A fetch-layer failure must not discard three phases of committed work.
    mockDeps({}, { throws: true });
    const response = await get(ok);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.transcribed).toBe(0);
    expect("stuckChunks" in body).toBe(false);
  });
});
