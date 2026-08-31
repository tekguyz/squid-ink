import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// Read-only import, not a modification: the scope fence puts lib/recorder/ off
// limits for EDITS, and re-declaring the bucket name here would create a second
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
import { sweep, type SweepPorts, type UploadingRow } from "@/lib/transcription/sweep";

/** The Vercel Cron entry point, and the ONE piece of application code that
 *  holds the Supabase secret key.
 *
 *  ------------------------------------------------------------------------
 *  SECRET KEY AMENDMENT. Until this route existed the secret key lived in
 *  exactly one place, scripts/verify-rls.mjs, and docs/DEPLOYMENT.md recorded
 *  that it was "correctly absent" from Vercel. That is no longer true, and the
 *  change is deliberate rather than a leak:
 *
 *    - scripts/verify-rls.mjs            — local only, reads .env.local
 *    - app/api/cron/transcribe/route.ts  — THIS file, server only
 *
 *  Nowhere else. Never NEXT_PUBLIC_-prefixed. The key is needed because a cron
 *  invocation has no user session and therefore no RLS identity: it must read
 *  and write rows belonging to whichever user recorded them. That is what
 *  bypassing RLS is for, and it is why this route is gated on CRON_SECRET
 *  before it touches anything.
 *  ------------------------------------------------------------------------
 *
 *  maxDuration is 300 because the TEKGUYZ team is on the Vercel Hobby plan,
 *  where 300 s is both the default and the hard ceiling — there is no extended
 *  duration to opt into (measured 2026-08-31). MAX_TRANSCRIPTIONS_PER_RUN is
 *  sized against that number, not against Pro's 800 s. */
export const maxDuration = 300;

/** Vercel sends the CRON_SECRET value as `Authorization: Bearer <value>`
 *  (vercel.com/docs/cron-jobs/manage-cron-jobs § Securing cron jobs).
 *
 *  An unset secret refuses everything. Failing open would leave a route that
 *  spends money on the Gemini API reachable by anyone who guesses the path. */
export function isAuthorized(request: Request, secret: string | undefined) {
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function storeFor(db: SupabaseClient): TranscriptionStore {
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
      // caller is transcribeOne, which always runs AFTER a successful claim to
      // 'analyzing', so no other expected value is reachable.
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

function portsFor(db: SupabaseClient, geminiKey: string): SweepPorts {
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
      // THE claim. One statement. Postgres row-locks the matched row, so a
      // concurrent invocation re-evaluates this WHERE after the lock releases
      // and matches nothing. No lock table, no read-then-write window.
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
    store: storeFor(db),
  };
}

export async function GET(request: Request) {
  if (!isAuthorized(request, process.env.CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!url || !secretKey || !geminiKey) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !secretKey && "SUPABASE_SECRET_KEY",
      !geminiKey && "GEMINI_API_KEY",
    ].filter(Boolean);

    console.error(`[transcribe] not configured: missing ${missing.join(", ")}`);
    return new Response(`Not configured: missing ${missing.join(", ")}`, {
      status: 500,
    });
  }

  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const report = await sweep(portsFor(db, geminiKey));
    console.log(`[transcribe] ${JSON.stringify(report)}`);
    return Response.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[transcribe] sweep aborted: ${message}`);
    return new Response(`Sweep failed: ${message}`, { status: 500 });
  }
}
