/** MIME-type resolution for a stored recording. Plain string and metadata
 *  handling — no SDK, no Storage client, no environment assumption — so the
 *  transcription cron and the browser playback helper share ONE copy of the
 *  reasoning rather than two that can drift apart.
 *
 *  It lived in lib/transcription/gemini-client.ts until 2026-08-31, and moved
 *  when playback needed it. That file re-exports it, so app/api/cron did not
 *  have to change. The move was not cosmetic: gemini-client.ts reaches the
 *  Gemini SDK through `await import("@google/genai")`, which a client bundle
 *  must not pull in.
 *
 *  The Gemini constraint that shaped it is still Gemini's, and is repeated
 *  here rather than assumed: it answers `400 Unsupported MIME type` for
 *  anything that is not a media container. The browser has the same need for a
 *  different reason — an <audio> source typed application/octet-stream will
 *  not decode.
 */

/** Default when nothing usable is on offer. WebM is what Chromium's
 *  MediaRecorder produces here, and codec.ts keeps it ahead of MP4. */
const FALLBACK_AUDIO_MIME = "audio/webm";

/** Pick the first candidate that actually names an audio container.
 *
 *  This lives here rather than in transcript.ts because the constraint is
 *  Gemini's: it answers `400 Unsupported MIME type` for anything that is not a
 *  media container. transcript.ts is the provider-neutral vocabulary and must
 *  not carry a provider's validation rule.
 *
 *  MEASURED 2026-08-31: Supabase Storage's download() hands back a Blob typed
 *  `application/octet-stream` regardless of what was uploaded, so the caller
 *  must prefer the object's own list() metadata and treat the Blob's type as a
 *  late fallback rather than as truth.
 *
 *  Parameters are stripped: MediaRecorder reports `audio/webm;codecs=opus`,
 *  and the container is the only part the transcription API wants.
 *
 *  `video/` is accepted on purpose. A MediaRecorder WebM holding nothing but
 *  audio is still labelled video/webm by some browsers, and refusing it would
 *  reject a perfectly transcribable file. */
export function resolveAudioMimeType(
  candidates: readonly (string | null | undefined)[],
): string {
  for (const candidate of candidates) {
    if (!candidate) continue;

    const container = candidate.split(";")[0].trim().toLowerCase();
    if (container.startsWith("audio/") || container.startsWith("video/")) {
      return container;
    }
  }

  return FALLBACK_AUDIO_MIME;
}
