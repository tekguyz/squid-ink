import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createNotegenPorts,
  createNotegenStore,
  resolvePersonaFor,
} from "@/lib/notegen/notegen-ports";
import { resolvePersonaFor as fromItsOwnModule } from "@/lib/notegen/resolve-persona";
import { generatedChunkRowsFor } from "@/lib/notegen/persist-result";

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

describe("resolvePersonaFor's re-export", () => {
  it("is the same function as resolve-persona.ts's", () => {
    // Its own behaviour is covered in resolve-persona.test.ts, where the
    // function now lives. This pins only the re-export, which exists so the
    // 2026-09-02 move did not have to touch every importer — and which a tidy
    // -up would otherwise delete without noticing anything broke here.
    expect(resolvePersonaFor).toBe(fromItsOwnModule);
  });
});

describe("claimForGeneration", () => {
  it("guards on BOTH processing_status and a null notegen_status", async () => {
    // The processing_status clause is what makes "cannot generate notes before
    // a transcript exists" true by construction. Losing it would be silent.
    const { db, chain } = fakeDb({
      data: [{ id: "n1", persona_id: null }],
      error: null,
    });
    await createNotegenPorts(db, "key").claimForGeneration("n1");

    expect(chain).toContainEqual(["update", { notegen_status: "generating" }]);
    expect(chain).toContainEqual(["eq", "id", "n1"]);
    expect(chain).toContainEqual(["eq", "processing_status", "completed"]);
    expect(chain).toContainEqual(["is", "notegen_status", null]);
  });

  it("RETURNS persona_id from the claim itself, not a second select", async () => {
    // The value generation uses must be the one on the row this UPDATE
    // row-locked. A second select afterwards could read a write that landed
    // in between, and the note would generate under a lens its owner had
    // already moved away from — which is the whole thing the lock prevents.
    const { db, chain, tables } = fakeDb({
      data: [{ id: "n1", persona_id: "p-uuid" }],
      error: null,
    });
    await createNotegenPorts(db, "key").claimForGeneration("n1");

    expect(chain).toContainEqual(["select", "id, persona_id"]);
    expect(tables).toEqual(["notes"]);
  });

  it("reports the claimed persona", async () => {
    const { db } = fakeDb({
      data: [{ id: "n1", persona_id: "p-uuid" }],
      error: null,
    });
    expect(await createNotegenPorts(db, "key").claimForGeneration("n1")).toEqual({
      status: "claimed",
      personaId: "p-uuid",
    });
  });

  it("distinguishes 'claimed with no persona' from 'lost'", async () => {
    // THE reason this is a tagged union. Both are falsy-adjacent, and a
    // nullable return would leave them told apart only by a caller checking
    // !== null against two different nullable things.
    const { db } = fakeDb({
      data: [{ id: "n1", persona_id: null }],
      error: null,
    });
    expect(await createNotegenPorts(db, "key").claimForGeneration("n1")).toEqual({
      status: "claimed",
      personaId: null,
    });
  });

  it("reports 'lost' on a zero-row claim", async () => {
    const { db } = fakeDb({ data: [], error: null });
    expect(await createNotegenPorts(db, "key").claimForGeneration("n1")).toEqual({
      status: "lost",
    });
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
      note: { title: "T", summary: "S", takeaways: ["t"], actionItems: ["a"] },
    });
    expect(rows.every((r) => r.persona_id === null)).toBe(true);

    const { db, chain } = fakeDb({ data: null, error: null });
    await createNotegenStore(db).deleteGeneratedChunks("n1");
    expect(chain).toContainEqual(["is", "persona_id", null]);
  });

  it("writes the title ONLY where notes.title is still null", async () => {
    // THE NULL-GUARD. notes.title is nullable with no default — "Untitled
    // note" is a render-time fallback, never a stored string — so is(null) is
    // an exact test for "nobody has named this note". Without this clause a
    // regeneration would overwrite a title the user typed.
    const { db, chain, tables } = fakeDb();
    await createNotegenStore(db).setTitleIfUnset("n1", "Mapping before billing");

    expect(tables).toEqual(["notes"]);
    expect(chain).toContainEqual(["update", { title: "Mapping before billing" }]);
    expect(chain).toContainEqual(["eq", "id", "n1"]);
    expect(chain).toContainEqual(["is", "title", null]);
  });

  it("reports false, and does not throw, when the row already had a title", async () => {
    // A manually renamed note matches zero rows. Cosmetic, not a failure: the
    // generation that produced the title still succeeded.
    const { db } = fakeDb({ data: [], error: null });
    expect(await createNotegenStore(db).setTitleIfUnset("n1", "T")).toBe(false);
  });

  it("logs and reports false on a write error, rather than throwing", async () => {
    // Throwing would fail a generation that actually succeeded, and send the
    // row to the staleness sweep over a label. Same reasoning as failNotegen.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({ data: null, error: { message: "boom" } });

    expect(await createNotegenStore(db).setTitleIfUnset("n1", "T")).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
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
