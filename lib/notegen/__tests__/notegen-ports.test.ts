import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createNotegenPorts,
  createNotegenStore,
  resolvePersonaFor,
} from "@/lib/notegen/notegen-ports";
import { generatedChunkRowsFor } from "@/lib/notegen/persist-result";
import {
  DEFAULT_PERSONA_FALLBACK,
  DEFAULT_PERSONA_ID,
} from "@/lib/notes/default-persona";

/** Records the whole builder chain, so a test can assert WHICH columns were
 *  filtered on rather than only that a row came back. The guarded UPDATE is
 *  this pipeline's one real guarantee; "it returned a row" would not prove the
 *  guard is present at all. */
function fakeDb(
  result: { data: unknown; error: unknown } = { data: [{ id: "n1" }], error: null },
) {
  const chain: [string, ...unknown[]][] = [];
  const tables: string[] = [];

  // Supabase's builder is itself thenable, so a chain ending in .select() is
  // awaited directly. EVERY method must therefore return the thenable, not a
  // bare object — an earlier version of this fake returned the raw builder and
  // the await resolved to undefined, which made "matched nothing" pass for the
  // wrong reason.
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(result),
    maybeSingle: vi.fn(async () => result),
  };

  for (const method of [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "is",
    "in",
    "lt",
    "order",
    "limit",
  ]) {
    builder[method] = vi.fn((...args: unknown[]) => {
      chain.push([method, ...args]);
      return builder;
    });
  }

  const db = {
    from: vi.fn((table: string) => {
      tables.push(table);
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { db, chain, tables };
}

describe("resolvePersonaFor", () => {
  it("filters on user_id and slug, never on id and never on name", async () => {
    const { db, chain } = fakeDb({
      data: { slug: DEFAULT_PERSONA_ID, name: "Neutral Analyst", depth: "dense" },
      error: null,
    });

    await resolvePersonaFor(db, "u1");

    const eqs = chain.filter(([m]) => m === "eq").map(([, col, val]) => [col, val]);
    expect(eqs).toEqual([
      ["user_id", "u1"],
      ["slug", DEFAULT_PERSONA_ID],
    ]);
    const columns = eqs.map(([c]) => c);
    expect(columns).not.toContain("id");
    expect(columns).not.toContain("name");
  });

  it("reads from personas", async () => {
    const { db, tables } = fakeDb({
      data: { slug: DEFAULT_PERSONA_ID, name: "Neutral Analyst", depth: "dense" },
      error: null,
    });
    await resolvePersonaFor(db, "u1");
    expect(tables).toEqual(["personas"]);
  });

  it("reports source 'row' when the account is provisioned", async () => {
    const { db } = fakeDb({
      data: { slug: DEFAULT_PERSONA_ID, name: "Neutral Analyst", depth: "brief" },
      error: null,
    });
    expect(await resolvePersonaFor(db, "u1")).toEqual({
      slug: DEFAULT_PERSONA_ID,
      name: "Neutral Analyst",
      depth: "brief",
      source: "row",
    });
  });

  it("falls back with source 'fallback' on zero rows", async () => {
    // An account created before the 2026-08-31 provisioning trigger, and
    // deliberately not backfilled.
    const { db } = fakeDb({ data: null, error: null });
    expect(await resolvePersonaFor(db, "u1")).toEqual({
      slug: DEFAULT_PERSONA_FALLBACK.id,
      name: DEFAULT_PERSONA_FALLBACK.name,
      depth: DEFAULT_PERSONA_FALLBACK.depth,
      source: "fallback",
    });
  });

  it("throws on a real query error rather than silently falling back", async () => {
    // permission denied is exactly what a missing service_role grant returns.
    // Swallowing it into the fallback would hide the grant gap behind output
    // that looks correct.
    const { db } = fakeDb({
      data: null,
      error: { message: "permission denied for table personas" },
    });
    await expect(resolvePersonaFor(db, "u1")).rejects.toThrow(/permission denied/);
  });
});

describe("claimForGeneration", () => {
  it("guards on BOTH processing_status and a null notegen_status", async () => {
    // The processing_status clause is what makes "cannot generate notes before
    // a transcript exists" true by construction. Losing it would be silent.
    const { db, chain } = fakeDb();
    await createNotegenPorts(db, "key").claimForGeneration("n1");

    expect(chain).toContainEqual(["update", { notegen_status: "generating" }]);
    expect(chain).toContainEqual(["eq", "id", "n1"]);
    expect(chain).toContainEqual(["eq", "processing_status", "completed"]);
    expect(chain).toContainEqual(["is", "notegen_status", null]);
  });

  it("is true only when exactly one row matched", async () => {
    const { db } = fakeDb({ data: [{ id: "n1" }], error: null });
    expect(await createNotegenPorts(db, "key").claimForGeneration("n1")).toBe(true);
  });

  it("is false when the guarded update matched nothing", async () => {
    const { db } = fakeDb({ data: [], error: null });
    expect(await createNotegenPorts(db, "key").claimForGeneration("n1")).toBe(false);
  });
});

describe("createNotegenStore", () => {
  it("deletes only this track's three chunk types", async () => {
    // A transcript_segment row belongs to the transcription pipeline. Deleting
    // it here would silently empty the transcript pane.
    const { db, chain } = fakeDb({ data: null, error: null });
    await createNotegenStore(db).deleteGeneratedChunks("n1");

    expect(chain).toContainEqual([
      "in",
      "chunk_type",
      ["summary", "takeaway", "action_item"],
    ]);
    expect(chain).toContainEqual(["eq", "note_id", "n1"]);
  });

  it("deletes ONLY default-lens rows, never another lens's takeaways", async () => {
    // THE DELETE SCOPE MUST MATCH THE INSERT SCOPE. generatedChunkRowsFor
    // always writes persona_id null, so this pipeline may only destroy
    // persona_id null rows.
    //
    // Without this clause the delete is wider than the insert and takes out
    // every lens-attributed takeaway on the note — rows this pipeline did not
    // write and cannot rewrite, because nothing sets a persona at capture. The
    // seeded note carries nine of them, three each for Sales Coach, Investor
    // and Engineering Lead, and losing them renders those three rails empty.
    const { db, chain } = fakeDb({ data: null, error: null });
    await createNotegenStore(db).deleteGeneratedChunks("n1");

    expect(chain).toContainEqual(["is", "persona_id", null]);
  });

  it("keeps the insert scope and the delete scope in step", async () => {
    // A guard against the two drifting apart in future edits: every row this
    // module's sibling builds carries persona_id null, and the delete filters
    // on exactly that.
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: { summary: "S", takeaways: ["t"], actionItems: ["a"] },
    });
    expect(rows.every((r) => r.persona_id === null)).toBe(true);

    const { db, chain } = fakeDb({ data: null, error: null });
    await createNotegenStore(db).deleteGeneratedChunks("n1");
    expect(chain).toContainEqual(["is", "persona_id", null]);
  });

  it("guards completeNotegen on 'generating' exactly", async () => {
    const { db, chain } = fakeDb();
    await createNotegenStore(db).completeNotegen("n1");
    expect(chain).toContainEqual(["update", { notegen_status: "completed" }]);
    expect(chain).toContainEqual(["eq", "notegen_status", "generating"]);
  });

  it("guards failNotegen on 'generating' exactly", async () => {
    // A looser guard would be a live hazard the moment a regeneration
    // affordance exists, flipping a fresh retry straight to terminal.
    const { db, chain } = fakeDb();
    await createNotegenStore(db).failNotegen("n1");
    expect(chain).toContainEqual(["update", { notegen_status: "failed" }]);
    expect(chain).toContainEqual(["eq", "notegen_status", "generating"]);
  });
});

describe("listGeneratable", () => {
  it("asks for completed notes with no notegen_status, oldest first", async () => {
    const { db, chain } = fakeDb({ data: [], error: null });
    await createNotegenPorts(db, "key").listGeneratable(20);

    expect(chain).toContainEqual(["eq", "processing_status", "completed"]);
    expect(chain).toContainEqual(["is", "notegen_status", null]);
    expect(chain).toContainEqual(["order", "updated_at", { ascending: true }]);
    expect(chain).toContainEqual(["limit", 20]);
  });
});

describe("listStaleGenerating", () => {
  it("measures staleness on updated_at, not created_at", async () => {
    const { db, chain } = fakeDb({ data: [], error: null });
    await createNotegenPorts(db, "key").listStaleGenerating("2026-09-02T00:00:00Z", 25);

    expect(chain).toContainEqual(["eq", "notegen_status", "generating"]);
    expect(chain).toContainEqual(["lt", "updated_at", "2026-09-02T00:00:00Z"]);
  });
});
