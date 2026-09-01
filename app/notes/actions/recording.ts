"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Creates the notes row for a recording, called as the upload STARTS.
 *
 * processing_status is 'uploading', and this track never writes anything else.
 * 'analyzing' and 'completed' belong to Track 3's transcription pipeline and are
 * explicitly outside this track's scope — writing 'analyzing' here would claim a
 * model pass that nothing performs.
 *
 * Writing the row before the bytes land is possible because the Storage path is
 * deterministic: the note id is generated on the client before capture begins,
 * so {user_id}/{note_id} is known up front and audio_storage_path can be filled
 * in immediately.
 *
 * A failed upload therefore leaves a row at 'uploading' whose object is missing.
 * That is the intended outcome, not a leak: the note is visible in the list, the
 * audio is still in IndexedDB, and a retry upserts the same row and the same
 * object. Whoever builds Track 3 must not assume an 'uploading' row has an
 * object behind it. The same id also makes this action safely retryable — it
 * upserts rather than failing on a duplicate key.
 *
 * Auth is checked here, not assumed. Next.js's own docs are explicit that
 * Server Functions are reachable by direct POST, not just through the UI. The
 * user id is read from the verified session and never taken from the argument;
 * RLS's `with check` on notes_insert_own then validates the value we supply.
 * That is supplying an owner, not filtering by one.
 */
export async function createRecordedNote(input: {
  noteId: string;
  audioStoragePath: string;
  durationSeconds: number;
}): Promise<{ id: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Cannot create a note: not signed in.");

  const { error } = await supabase.from("notes").upsert(
    {
      id: input.noteId,
      user_id: user.id,
      audio_storage_path: input.audioStoragePath,
      // The column is integer; a fractional duration would be silently
      // truncated by Postgres, so truncate deliberately and visibly.
      audio_duration_seconds: Math.floor(input.durationSeconds),
      processing_status: "uploading",
    },
    { onConflict: "id" },
  );

  if (error) throw new Error(`Failed to create note: ${error.message}`);

  revalidatePath("/");
  return { id: input.noteId };
}

/**
 * Tier 1 of the two-tier reconciliation for a failed upload
 * (docs/KNOWN_GAPS.md § Recorder HUD). Called from the recorder's catch block
 * the instant a Storage transfer throws.
 *
 * Tier 2 — the staleness sweep in lib/transcription/sweep.ts — reaches the same
 * row only after an hour, and on the Vercel Hobby daily cron that can be a full
 * day. Nothing about that wait is informative: the client that caused the
 * failure already knows. So this writes 'failed' with no threshold and no
 * retry-then-fail.
 *
 * Tier 2 confirms the object is absent before failing a row; tier 1 has no such
 * evidence — it fires purely on "the client caught an error". That is only safe
 * because the caller's try block is scoped to the Storage transfer itself, and
 * because of the guard below.
 *
 * THE GUARD. `.eq('processing_status', 'uploading')` is the same one-statement
 * atomic claim sweep.ts uses. Postgres row-locks the matched row, so a
 * duplicate call, or a race with a cron invocation that already advanced the
 * row to 'analyzing' or 'completed', matches nothing instead of dragging
 * finished work back to a terminal state. Zero rows matched is not an error
 * here — it means somebody else got there first, which is the correct outcome.
 *
 * The authenticated server client, never the secret key: RLS supplies the owner
 * and the secret key stays confined to app/api/cron/transcribe/route.ts. There
 * is deliberately no `.eq('user_id', ...)` — an application filter would mask
 * an RLS failure instead of exposing it.
 */
export async function markUploadFailed(noteId: string): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Cannot fail a note: not signed in.");

  const { error } = await supabase
    .from("notes")
    .update({ processing_status: "failed" })
    .eq("id", noteId)
    .eq("processing_status", "uploading")
    .select("id");

  if (error) throw new Error(`Failed to mark note as failed: ${error.message}`);

  revalidatePath("/");
}
