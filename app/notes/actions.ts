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
