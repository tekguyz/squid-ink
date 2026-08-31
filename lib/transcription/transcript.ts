import type { SpeakerToken } from "@/lib/notes/view-types";

/** The vocabulary every module downstream of the transcriber speaks.
 *
 *  Nothing here knows Gemini exists. That is the point: gemini-client.ts is the
 *  only file that may import the SDK or name a wire field, so swapping the
 *  provider is a one-file change. */

export interface TranscriptSegment {
  /** The provider's own label, e.g. "spk_1". Null when not diarized. */
  speakerLabel: string | null;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface TranscriptionResult {
  rawTranscript: string;
  segments: TranscriptSegment[];
  /** What actually happened, not what was requested. */
  diarized: boolean;
}

export interface TranscribeRequest {
  audio: Blob;
  mimeType: string;
  diarize: boolean;
}

export type Transcriber = (
  request: TranscribeRequest,
) => Promise<TranscriptionResult>;

/** globals.css defines exactly three speaker tokens, and
 *  components/note-detail/speaker-colors.ts is a static lookup because Tailwind
 *  cannot build a class name at runtime. Gemini diarizes up to eight speakers,
 *  so past the third the colour cycles.
 *
 *  The cycle is cosmetic and deliberate: two speakers sharing a colour is a
 *  legibility cost, whereas renaming Speaker 4 to Speaker 1 would be the page
 *  asserting something false about who spoke. */
const SPEAKER_TOKENS: readonly SpeakerToken[] = [
  "speaker-1",
  "speaker-2",
  "speaker-3",
];

/** Distinct speaker labels in first-appearance order, numbered from 1.
 *
 *  The provider's label is an OPAQUE CLUSTER ID and its digits mean nothing.
 *  Measured against the live API on 2026-08-31: a recording with exactly one
 *  voice came back labelled "spk:7" — a colon rather than the documented
 *  underscore, and a 7 that indexes nothing. Parsing a number out of the label
 *  would have rendered "Speaker 7" for a monologue.
 *
 *  Appearance order is the only honest numbering available: whoever speaks
 *  first is Speaker 1. It is also stable, because the segments are already in
 *  timeline order. */
export function speakerOrdinals(
  segments: readonly TranscriptSegment[],
): Map<string, number> {
  const ordinals = new Map<string, number>();

  for (const segment of segments) {
    const label = segment.speakerLabel;
    if (!label) continue;
    if (!ordinals.has(label)) ordinals.set(label, ordinals.size + 1);
  }

  return ordinals;
}

export function speakerFor(
  ordinal: number | null | undefined,
): { name: string; initials: string; token: SpeakerToken } | null {
  if (ordinal === null || ordinal === undefined) return null;
  if (!Number.isFinite(ordinal) || ordinal < 1) return null;

  return {
    name: `Speaker ${ordinal}`,
    initials: `S${ordinal}`,
    token: SPEAKER_TOKENS[(ordinal - 1) % SPEAKER_TOKENS.length],
  };
}

/** Default when nothing usable is on offer. WebM is what Chromium's
 *  MediaRecorder produces here, and codec.ts keeps it ahead of MP4. */
const FALLBACK_AUDIO_MIME = "audio/webm";

/** Pick the first candidate that actually names an audio container.
 *
 *  MEASURED 2026-08-31: Supabase Storage's download() hands back a Blob typed
 *  `application/octet-stream` regardless of what was uploaded, and Gemini
 *  rejects that with `400 Unsupported MIME type`. The object's own list()
 *  metadata carries the real type, so the fix is to prefer that and treat the
 *  Blob's own type as a late fallback rather than as truth.
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

/** A DISPLAY value. note-view-model.ts renders metadata.ts_start verbatim, so
 *  this must already be human-readable — which is exactly why the unrounded
 *  seconds are stored separately in ts_start_seconds. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const s = String(total % 60).padStart(2, "0");
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);

  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${s}`;
  return `${String(m).padStart(2, "0")}:${s}`;
}
