import type { SupabaseClient } from "@supabase/supabase-js";
// Read-only import: re-declaring the bucket name here would create a second
// place for it to drift. upload-audio.ts is pure types and functions with no
// browser-only import, so it is safe on the server.
import { AUDIO_BUCKET } from "@/lib/recorder/upload-audio";
import {
  createGeminiTranscriber,
  resolveAudioMimeType,
} from "@/lib/transcription/gemini-client";
import type {
  NoteChunkInsert,
  TranscriptionStore,
} from "@/lib/transcription/persist-result";
import type { SweepPorts, UploadingRow } from "@/lib/transcription/sweep";

/** The Supabase implementation of SweepPorts — the only place in the project
 *  that turns the state machine's ports into real queries.
 *
 *  It lived inside app/api/cron/transcribe/route.ts until 2026-09-01, when the
 *  manual "Transcribe" Server Action became a second caller. THE CLAIM IS THE
 *  REASON IT MOVED: a second copy of
 *  `update ... eq(id) ... eq(processing_status, expected) ... select()` would be
 *  a second mechanism for the one guarantee this pipeline actually depends on.
 *  There is one, here, and both callers use it.
 *
 *  Nothing here reads an environment variable. The caller supplies the client,
 *  which is what lets the cron pass a secret-key client (no session, so no RLS
 *  identity) and the Server Action pass the authenticated cookie client (RLS
 *  supplies the owner) without this file knowing the difference. */

export function createTranscriptionStore(db: SupabaseClient): TranscriptionStore {
  return {
    async deleteTranscriptChunks(noteId) {
      const { error } = await db
        .from("note_chunks")
        .delete()
        .eq("note_id", noteId)
        .eq("chunk_type", "transcript_segment");
      if (error) throw new Error(`clearing old chunks failed: ${error.message}`);
    },

    async insertChunks(rows: NoteChunkInsert[]) {
      const { error } = await db.from("note_chunks").insert(rows);
      if (error) throw new Error(`chunk insert failed: ${error.message}`);
    },

    async completeNote({ noteId, rawTranscript, diarized }) {
      // Atomic, same shape as the claim: the eq on processing_status is what
      // makes a lost race return zero rows instead of overwriting somebody
      // else's work.
      const { data, error } = await db
        .from("notes")
        .update({
          raw_transcript: rawTranscript,
          diarization_enabled: diarized,
          processing_status: "completed",
        })
        .eq("id", noteId)
        .eq("processing_status", "analyzing")
        .select("id");

      if (error) throw new Error(`completing note failed: ${error.message}`);
      return (data?.length ?? 0) === 1;
    },

    async markFailed(noteId, reason) {
      // Guarded on 'analyzing' exactly, matching completeNote above. The only
      // caller is transcribeClaimedNote, which always runs AFTER a successful
      // claim to 'analyzing', so no other expected value is reachable.
      //
      // A looser `.in(['uploading','analyzing'])` would be a live hazard the
      // moment a retry affordance is added: createRecordedNote upserts a row
      // back to 'uploading', and this call would then flip that fresh retry to
      // a terminal 'failed'. Narrow guard, no such window.
      const { data, error } = await db
        .from("notes")
        .update({ processing_status: "failed" })
        .eq("id", noteId)
        .eq("processing_status", "analyzing")
        .select("id");

      if (error) {
        console.error(
          `[transcribe] could not mark ${noteId} failed`,
          error.message,
        );
      } else if ((data?.length ?? 0) === 0) {
        // Someone else moved the row. Say so rather than silently doing
        // nothing — this is the only place it would ever be visible.
        console.error(
          `[transcribe] note ${noteId} was no longer 'analyzing'; not marked failed`,
        );
      }

      console.error(`[transcribe] note ${noteId} failed: ${reason}`);
    },
  };
}

export function createTranscriptionPorts(
  db: SupabaseClient,
  geminiKey: string,
): SweepPorts {
  const bucket = db.storage.from(AUDIO_BUCKET);

  /** One list() lookup serving both the existence check and the MIME type.
   *  The path is always {user_id}/{note_id} — two segments, that order. */
  async function objectRow(path: string) {
    const slash = path.indexOf("/");

    // Throw rather than mis-parse. With indexOf returning -1, slice(0, -1)
    // would silently drop the last character and the lookup would miss —
    // reporting "the upload never landed" for a path that was merely
    // malformed, which is a wrong answer dressed as a legitimate outcome.
    if (slash <= 0 || slash === path.length - 1) {
      throw new Error(
        `audio_storage_path must be {user_id}/{note_id}, got "${path}"`,
      );
    }

    const prefix = path.slice(0, slash);
    const name = path.slice(slash + 1);

    const { data, error } = await bucket.list(prefix, { search: name });
    if (error) throw new Error(`storage list failed: ${error.message}`);

    return (data ?? []).find((object) => object.name === name) ?? null;
  }

  return {
    now: () => Date.now(),
    log: (message) => console.log(`[transcribe] ${message}`),

    async listUploading(limit) {
      const { data, error } = await db
        .from("notes")
        .select(
          "id, user_id, audio_storage_path, audio_duration_seconds, updated_at",
        )
        .eq("processing_status", "uploading")
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (error) throw new Error(`listing 'uploading' failed: ${error.message}`);
      return (data ?? []) as UploadingRow[];
    },

    async listStaleAnalyzing(cutoffIso, limit) {
      const { data, error } = await db
        .from("notes")
        .select("id")
        .eq("processing_status", "analyzing")
        .lt("updated_at", cutoffIso)
        .limit(limit);

      if (error) throw new Error(`listing 'analyzing' failed: ${error.message}`);
      return (data ?? []).map((r) => r.id as string);
    },

    async claim(noteId, expected, next) {
      // THE claim. One statement, one implementation, two callers. Postgres
      // row-locks the matched row, so a concurrent invocation re-evaluates this
      // WHERE after the lock releases and matches nothing. No lock table, no
      // read-then-write window.
      const { data, error } = await db
        .from("notes")
        .update({ processing_status: next })
        .eq("id", noteId)
        .eq("processing_status", expected)
        .select("id");

      if (error) throw new Error(`claim failed: ${error.message}`);
      return (data?.length ?? 0) === 1;
    },

    async objectExists(path) {
      // list(), never download(). Storage serves object reads through a
      // caching CDN and a download() straight after an upsert returns the
      // PRE-overwrite body — observed on this project during Track 1.
      return (await objectRow(path)) !== null;
    },

    async downloadAudio(path) {
      // The one download() in this track, and it proves nothing — it only
      // moves bytes to Gemini. Existence was already settled by list().
      const row = await objectRow(path);

      const { data, error } = await bucket.download(path);
      if (error || !data) {
        throw new Error(`audio download failed: ${error?.message ?? "no body"}`);
      }

      // The object's stored metadata FIRST, the Blob's own type second.
      // MEASURED: download() reports application/octet-stream whatever was
      // uploaded, and Gemini 400s on it.
      const mimeType = resolveAudioMimeType([
        row?.metadata?.mimetype as string | undefined,
        data.type,
      ]);

      return { blob: data, mimeType };
    },

    transcribe: createGeminiTranscriber(geminiKey),
    store: createTranscriptionStore(db),
  };
}
