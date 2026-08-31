/**
 * Direct client-to-Storage upload. No signed URL, no server relay — the decided
 * architecture, and the three policies in supabase/schemas/storage_audio.sql
 * are what make it safe.
 *
 * The path is not a naming convention. All three policies check
 *
 *   (storage.foldername(name))[1] = (select auth.uid())::text
 *
 * so the first path segment IS the authorization check. A prefix, a reordered
 * pair, or a different id is refused by RLS as a permission error that reads
 * like a generic failure. Two segments, that order, no extension.
 *
 * upsert is on because a retried upload after an interrupted recording is a
 * normal recorder scenario, and Track 1 shipped the UPDATE policy for exactly
 * that case (INSERT alone makes replacement fail silently).
 *
 * Success and size are read from the upload response and from list(), never
 * from download(). Storage serves object reads through a caching CDN, and a
 * download() issued straight after an upsert returns the PRE-overwrite body —
 * observed on this project during Track 1 (docs/KNOWN_GAPS.md).
 */
export const AUDIO_BUCKET = "audio-recordings";

export interface StorageBucketLike {
  upload(
    path: string,
    body: Blob,
    options: { contentType: string; upsert: boolean },
  ): Promise<{ data: { path: string } | null; error: { message: string } | null }>;
  list(
    prefix: string,
    options?: { search?: string },
  ): Promise<{
    data: { name: string; metadata?: { size?: number } }[] | null;
    error: { message: string } | null;
  }>;
}

export function recordingPath(userId: string, noteId: string): string {
  return `${userId}/${noteId}`;
}

export async function uploadRecording(args: {
  bucket: StorageBucketLike;
  userId: string;
  noteId: string;
  blob: Blob;
  contentType: string;
}): Promise<{ path: string; sizeBytes: number }> {
  const { bucket, userId, noteId, blob, contentType } = args;
  const path = recordingPath(userId, noteId);

  const { error } = await bucket.upload(path, blob, { contentType, upsert: true });
  if (error) throw new Error(`Audio upload failed: ${error.message}`);

  // list() reads storage.objects itself and runs under the SELECT policy, so a
  // row coming back is proof the object landed under this user's prefix.
  const listing = await bucket.list(userId, { search: noteId });
  if (listing.error) {
    throw new Error(`Audio upload could not be confirmed: ${listing.error.message}`);
  }

  const row = listing.data?.find((object) => object.name === noteId);
  if (!row) {
    throw new Error(`Audio upload finished but the object is not visible at ${path}`);
  }

  return { path, sizeBytes: row.metadata?.size ?? 0 };
}
