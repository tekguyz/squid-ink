/**
 * Container/codec negotiation for MediaRecorder.
 *
 * Ordered most- to least-preferred. Nothing here is hardcoded to one browser:
 * the caller passes `MediaRecorder.isTypeSupported`, and the first string it
 * accepts wins.
 *
 *   - Chromium supports the WebM/Opus pair. Opus is the right default: it is
 *     the best speech codec at low bitrate, which is what a meeting recording
 *     is made of.
 *   - Safari supports no WebM at all and answers only to audio/mp4 (AAC-LC,
 *     RFC 6381 code mp4a.40.2). WebM is listed first precisely so Chromium
 *     never reaches the MP4 entries.
 *   - The bare container strings are the fallbacks for browsers that refuse a
 *     codecs= parameter they otherwise honour.
 *
 * A null return is a real answer, not an error to swallow: the caller must
 * surface "this browser cannot record" rather than pick a string blind.
 */
export const CODEC_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  for (const candidate of CODEC_CANDIDATES) {
    if (isSupported(candidate)) return candidate;
  }
  return null;
}
