import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEmbeddingPorts } from "@/lib/rag/supabase-ports";
import { MAX_EMBED_ATTEMPTS } from "@/lib/rag/sweep";

/** A chainable PostgREST double that records every filter it was given. */
function queryDouble(result: { data?: unknown; error?: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};

  for (const method of [
    "select",
    "eq",
    "is",
    "or",
    "order",
    "limit",
    "update",
    "delete",
    "in",
  ]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  // Awaiting the chain resolves to the PostgREST result.
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);

  return { chain, calls };
}

function dbDouble(result: { data?: unknown; error?: unknown }) {
  const { chain, calls } = queryDouble(result);
  const from = vi.fn(() => chain);
  return { db: { from } as unknown as SupabaseClient, calls, from };
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
    await expect(createEmbeddingPorts(db, "k").listPending(10)).rejects.toThrow(
      /boom/,
    );
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
    const won = await createEmbeddingPorts(db, "k").writeEmbedding("c1", [
      0.1, 0.2,
    ]);

    expect(won).toBe(true);
    expect(calls.find((c) => c.method === "update")?.args[0]).toEqual({
      embedding: "[0.1,0.2]",
    });
    expect(calls).toContainEqual({ method: "eq", args: ["id", "c1"] });
    expect(calls).toContainEqual({ method: "is", args: ["embedding", null] });
  });

  it("reports losing the race when the guard matched nothing", async () => {
    const { db } = dbDouble({ data: [], error: null });
    expect(
      await createEmbeddingPorts(db, "k").writeEmbedding("c1", [0.1]),
    ).toBe(false);
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

  it("reads no environment variable — the caller supplies both dependencies", () => {
    // This is what keeps VOYAGE_API_KEY out of every client component's import
    // graph: lib/rag/* cannot leak a key it never reads.
    const source = readFileSync(
      path.resolve(import.meta.dirname, "../supabase-ports.ts"),
      "utf8",
    );
    expect(source).not.toContain("process.env");
  });
});
