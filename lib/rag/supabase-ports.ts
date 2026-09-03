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
 *  token client (RLS supplies the owner) without this file knowing which. It
 *  is also what keeps VOYAGE_API_KEY out of every client component's import
 *  graph: a module that never reads the key cannot leak it. Same shape as
 *  lib/transcription/supabase-ports.ts. */

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

      if (error) {
        throw new Error(`listing pending chunks failed: ${error.message}`);
      }
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
        throw new Error(
          `listing pending chunks for ${noteId} failed: ${error.message}`,
        );
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

      if (error) {
        throw new Error(
          `writing embedding for ${chunkId} failed: ${error.message}`,
        );
      }
      return (data?.length ?? 0) === 1;
    },

    async recordAttempt(chunkId, metadata: ChunkMetadata) {
      // Guarded on embedding IS NULL too: if the other trigger embedded this
      // chunk while we were failing on it, there is nothing to record and the
      // successful row must not be stamped with our error.
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
        console.error(
          `[embed] could not record an attempt on ${chunkId}`,
          error.message,
        );
      }
    },

    embed: createVoyageEmbedder(voyageKey),
  };
}
