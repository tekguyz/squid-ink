import { createClient } from "@/lib/supabase/client";
import { resolveAudioMimeType } from "@/lib/audio/mime-type";
import { AUDIO_BUCKET } from "@/lib/recorder/upload-audio";

/**
 * Fetch a note's recording from the private Storage bucket and turn it into
 * something an <audio> element can play.
 *
 * Client-safe by design: it uses the BROWSER Supabase client, so the read runs
 * as the signed-in user and the three policies in
 * supabase/schemas/storage_audio.sql are what authorise it. No signed URL and
 * no server relay — the same shape as the upload, in reverse.
 *
 * Existence is proved with list(), never by treating a download error as
 * "missing". That mirrors the recorder and the transcription sweep: a row can
 * name a path whose object never landed, and a 'failed' note is exactly that.
 *
 * KNOWN LIMITATION, accepted. Storage reads go through a caching CDN, so a
 * recording overwritten seconds ago could serve its previous body. This is not
 * the post-upload window CLAUDE.md warns about — playback happens long after,
 * and only once transcription has run — so nothing here tries to defeat the
 * cache.
 */

export interface PlaybackStorage {
  list(
    prefix: string,
    options?: { search?: string },
  ): Promise<{
    data: { name: string; metadata?: { mimetype?: string } | null }[] | null;
    error: { message: string } | null;
  }>;
  download(
    path: string,
  ): Promise<{ data: Blob | null; error: { message: string } | null }>;
}

export interface PlaybackObject {
  /** An object URL. The caller owns it and MUST call revoke(). */
  url: string;
  mimeType: string;
  revoke(): void;
}

function browserStorage(): PlaybackStorage {
  return createClient().storage.from(AUDIO_BUCKET) as unknown as PlaybackStorage;
}

/**
 * Returns null when the object is not there — a note whose upload failed, or
 * one recorded before the bucket existed. That is a state to render, not an
 * error to throw. A genuine transport or permission failure still throws.
 */
export async function loadNoteAudio(
  storagePath: string,
  storage: PlaybackStorage = browserStorage(),
): Promise<PlaybackObject | null> {
  // The path is {user_id}/{note_id}: two segments, that order, no extension.
  // The first segment is also the authorisation check every policy makes.
  const slash = storagePath.indexOf("/");
  const prefix = storagePath.slice(0, slash);
  const name = storagePath.slice(slash + 1);

  const listing = await storage.list(prefix, { search: name });
  if (listing.error) {
    throw new Error(`Could not read the recording: ${listing.error.message}`);
  }

  const object = listing.data?.find((row) => row.name === name);
  if (!object) return null;

  const { data: blob, error } = await storage.download(storagePath);
  if (error) throw new Error(`Could not download the recording: ${error.message}`);
  if (!blob) return null;

  // download() types every Blob application/octet-stream, so the object's own
  // metadata is the truthful candidate and the Blob is the late fallback.
  const mimeType = resolveAudioMimeType([object.metadata?.mimetype, blob.type]);

  // Re-typed, not re-encoded: the bytes are untouched, only the label changes.
  const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));

  return { url, mimeType, revoke: () => URL.revokeObjectURL(url) };
}
