import type { SupabaseClient } from "@supabase/supabase-js";
import { createGeminiNoteGenerator } from "@/lib/notegen/gemini-client";
import type { NotegenStore } from "@/lib/notegen/persist-result";
import type {
  GeneratableRow,
  NotegenPorts,
  ResolvedPersona,
} from "@/lib/notegen/sweep";
import { resolvePersonaFor } from "@/lib/notegen/resolve-persona";

/** Re-exported so callers and tests that already import it from here keep
 *  working. It MOVED on 2026-09-02, it did not change owner: per-note lens
 *  selection gave it a second branch, and this file was 227 lines against a
 *  250-line soft ceiling. See lib/notegen/resolve-persona.ts. */
export { resolvePersonaFor } from "@/lib/notegen/resolve-persona";

/** The Supabase implementation of NotegenPorts — the only place in this track
 *  that turns the state machine's ports into real queries.
 *
 *  THE CLAIM IS THE REASON THIS IS ONE FILE. A second copy of the guarded
 *  UPDATE would be a second mechanism for the guarantee this pipeline actually
 *  depends on. There is one, here, and both callers use it. The same reasoning
 *  moved lib/transcription/supabase-ports.ts out of the cron route on
 *  2026-09-01.
 *
 *  Nothing here reads an environment variable. The caller supplies the client,
 *  which is what lets the cron pass a secret-key client (no session, so no RLS
 *  identity) and the Server Action pass a token client (RLS supplies the
 *  owner) without this file knowing the difference. */

/** This track's three types, and only these. A transcript_segment row belongs
 *  to the transcription pipeline. */
const GENERATED_TYPES = ["summary", "takeaway", "action_item"] as const;

export function createNotegenStore(db: SupabaseClient): NotegenStore {
  return {
    async deleteGeneratedChunks(noteId) {
      // Scoped THREE ways, and every one of them is load-bearing.
      //
      // chunk_type: deleting a transcript_segment here would silently empty
      // the transcript pane for a note that transcribed fine.
      //
      // persona_id IS NULL: THE DELETE SCOPE MUST MATCH THE INSERT SCOPE.
      // generatedChunkRowsFor always writes persona_id null, so this pipeline
      // only ever creates default-lens rows and must only ever destroy them.
      // Without this clause the delete is WIDER than the insert: it would take
      // out every lens-attributed takeaway on the note — rows this pipeline
      // did not write and cannot rewrite, since nothing sets a persona at
      // capture — and the Sales Coach, Investor and Engineering Lead rails
      // would render empty. Measured 2026-09-02 against the seeded note, which
      // carries nine such takeaways, three per lens.
      const { error } = await db
        .from("note_chunks")
        .delete()
        .eq("note_id", noteId)
        .is("persona_id", null)
        .in("chunk_type", [...GENERATED_TYPES]);
      if (error) {
        throw new Error(`clearing old generated chunks failed: ${error.message}`);
      }
    },

    async insertChunks(rows) {
      const { error } = await db.from("note_chunks").insert(rows);
      if (error) throw new Error(`chunk insert failed: ${error.message}`);
    },

    async completeNotegen(noteId) {
      // Atomic, same shape as the claim: the eq on notegen_status is what
      // makes a lost race return zero rows instead of overwriting somebody
      // else's work.
      const { data, error } = await db
        .from("notes")
        .update({ notegen_status: "completed" })
        .eq("id", noteId)
        .eq("notegen_status", "generating")
        .select("id");

      if (error) throw new Error(`completing note gen failed: ${error.message}`);
      return (data?.length ?? 0) === 1;
    },

    async failNotegen(noteId) {
      // Guarded on 'generating' exactly. A looser guard would be a live hazard
      // the moment a regeneration affordance is added: it would flip a fresh
      // retry straight to terminal. Same trap markFailed avoids in the
      // transcription store.
      const { data, error } = await db
        .from("notes")
        .update({ notegen_status: "failed" })
        .eq("id", noteId)
        .eq("notegen_status", "generating")
        .select("id");

      if (error) {
        // Logged, not thrown. The callers are already on a failure path and a
        // throw here would replace the real reason with this one.
        console.error(`[notegen] could not mark ${noteId} failed`, error.message);
        return false;
      }
      return (data?.length ?? 0) === 1;
    },
  };
}

export function createNotegenPorts(
  db: SupabaseClient,
  geminiKey: string,
): NotegenPorts {
  return {
    now: () => Date.now(),
    log: (message) => console.log(`[notegen] ${message}`),

    async listGeneratable(limit) {
      const { data, error } = await db
        .from("notes")
        .select("id, user_id, raw_transcript, updated_at")
        .eq("processing_status", "completed")
        .is("notegen_status", null)
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(`listing generatable notes failed: ${error.message}`);
      }
      return (data ?? []) as GeneratableRow[];
    },

    async listStaleGenerating(cutoffIso, limit) {
      // updated_at, not created_at. For a 'generating' row updated_at is when
      // it was claimed, which is exactly the crash window worth measuring.
      const { data, error } = await db
        .from("notes")
        .select("id")
        .eq("notegen_status", "generating")
        .lt("updated_at", cutoffIso)
        .limit(limit);

      if (error) {
        throw new Error(`listing stale 'generating' failed: ${error.message}`);
      }
      return (data ?? []).map((r) => r.id as string);
    },

    async claimForGeneration(noteId) {
      // THE claim. One statement, one implementation, two callers. Postgres
      // row-locks the matched row, so a concurrent invocation re-evaluates
      // this WHERE after the lock releases and matches nothing. No lock table,
      // no read-then-write window.
      //
      // The processing_status clause is load-bearing, not belt-and-braces: it
      // is what makes "cannot generate notes before a transcript exists" true
      // by construction rather than by caller discipline.
      //
      // persona_id RIDES OUT ON THE RETURNING, added 2026-09-02, and that is
      // not a convenience. A second select after the claim could read a write
      // that landed between the two, so the note would generate under a lens
      // its owner had already moved away from. This value is the one on the
      // row this statement locked, which is the only version of it that
      // cannot change underneath the generation it feeds.
      const { data, error } = await db
        .from("notes")
        .update({ notegen_status: "generating" })
        .eq("id", noteId)
        .eq("processing_status", "completed")
        .is("notegen_status", null)
        .select("id, persona_id");

      if (error) throw new Error(`notegen claim failed: ${error.message}`);

      const rows = (data ?? []) as { id: string; persona_id: string | null }[];
      if (rows.length !== 1) return { status: "lost" };
      return { status: "claimed", personaId: rows[0].persona_id };
    },

    resolvePersona: (userId, personaId) =>
      resolvePersonaFor(db, userId, personaId),
    generate: createGeminiNoteGenerator(geminiKey),
    store: createNotegenStore(db),
  };
}
