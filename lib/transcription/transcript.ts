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

export function speakerFor(
  label: string | null,
): { name: string; initials: string; token: SpeakerToken } | null {
  if (!label) return null;

  const digits = /(\d+)\s*$/.exec(label);
  if (!digits) return null;

  const n = Number(digits[1]);
  if (!Number.isFinite(n) || n < 1) return null;

  return {
    name: `Speaker ${n}`,
    initials: `S${n}`,
    token: SPEAKER_TOKENS[(n - 1) % SPEAKER_TOKENS.length],
  };
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
