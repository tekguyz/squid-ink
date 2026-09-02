import type { SupabaseClient } from "@supabase/supabase-js";
import { createGeminiNoteGenerator } from "@/lib/notegen/gemini-client";
import type { NotegenStore } from "@/lib/notegen/persist-result";
import type {
  GeneratableRow,
  NotegenPorts,
  ResolvedPersona,
} from "@/lib/notegen/sweep";
import {
  DEFAULT_PERSONA_FALLBACK,
  DEFAULT_PERSONA_ID,
} from "@/lib/notes/default-persona";

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
      // Scoped to this track's types. Deleting a transcript_segment here would
      // silently empty the transcript pane for a note that transcribed fine.
      const { error } = await db
        .from("note_chunks")
        .delete()
        .eq("note_id", noteId)
        .in("chunk_type", GENERATED_TYPES as unknown as string[]);
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

/** Which persona config a note generates under.
 *
 *  SCOPED BY user_id AND slug. Never personas.id — that is a per-user
 *  gen_random_uuid() from the provisioning trigger, while DEFAULT_PERSONA_ID
 *  is the slug string "neutral-analyst", so the comparison would be a type
 *  error rather than a quiet miss. Never name either: personas.sql declares
 *  and indexes unique (user_id, slug) and states in its own header that slug
 *  is the key chosen to survive a reseed, whereas name is display text
 *  carrying no constraint at all. Recorded in CLAUDE.md § Data and
 *  DECISIONS.md § Personas on 2026-09-02.
 *
 *  THE user_id FILTER IS THE ONE DELIBERATE EXCEPTION to the standing rule
 *  that queries never filter on user_id in application code. That rule exists
 *  because RLS supplies the owner and a redundant filter would mask an RLS
 *  failure instead of exposing it. The cron caller has no RLS to mask:
 *  service_role bypasses it entirely, so an unfiltered lookup would return
 *  whichever account's neutral-analyst row Postgres reached first. The Server
 *  Action caller filters identically, where it is defence in depth and one
 *  shared query shape rather than a requirement. */
export async function resolvePersonaFor(
  db: SupabaseClient,
  userId: string,
): Promise<ResolvedPersona> {
  const { data, error } = await db
    .from("personas")
    .select("slug, name, depth")
    .eq("user_id", userId)
    .eq("slug", DEFAULT_PERSONA_ID)
    .maybeSingle<{
      slug: string;
      name: string;
      depth: ResolvedPersona["depth"];
    }>();

  // Thrown, not swallowed into the fallback. "permission denied for table
  // personas" is precisely what a missing service_role grant returns, and
  // falling back would hide that behind output that looks correct — which is
  // how the notes and note_chunks grant gaps stayed invisible until 2026-08-31.
  if (error) throw new Error(`resolving persona failed: ${error.message}`);

  if (data) {
    return {
      slug: data.slug,
      name: data.name,
      depth: data.depth,
      source: "row",
    };
  }

  // Zero rows: an account created before the 2026-08-31 provisioning trigger
  // and deliberately not backfilled. The fallback is a crash floor that keeps
  // generation working for it.
  return {
    slug: DEFAULT_PERSONA_FALLBACK.id,
    name: DEFAULT_PERSONA_FALLBACK.name,
    depth: DEFAULT_PERSONA_FALLBACK.depth,
    source: "fallback",
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
      const { data, error } = await db
        .from("notes")
        .update({ notegen_status: "generating" })
        .eq("id", noteId)
        .eq("processing_status", "completed")
        .is("notegen_status", null)
        .select("id");

      if (error) throw new Error(`notegen claim failed: ${error.message}`);
      return (data?.length ?? 0) === 1;
    },

    resolvePersona: (userId) => resolvePersonaFor(db, userId),
    generate: createGeminiNoteGenerator(geminiKey),
    store: createNotegenStore(db),
  };
}
