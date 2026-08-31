import type {
  TranscribeRequest,
  Transcriber,
  TranscriptSegment,
  TranscriptionResult,
} from "@/lib/transcription/transcript";

/** The ONLY module that knows Gemini's wire format.
 *
 *  Everything below the interface boundary speaks TranscriptionResult, so
 *  replacing the provider is a change to this file and nothing else.
 *
 *  The shapes below were read from node_modules/@google/genai/dist/genai.d.ts
 *  on 2026-08-31, not recalled and not copied from the web docs. Three details
 *  are load-bearing and each was verified against those types:
 *
 *  1. THE TWO SURFACES DISAGREE ON CASING. `interactions.create` takes
 *     snake_case (`generation_config`, `transcription_config`,
 *     `diarization_mode`, `mime_type`), but `files.upload` is the older Files
 *     API surface and takes camelCase (`mimeType`). The published web sample
 *     writes `mime_type` in the upload config, where it is silently ignored and
 *     the type is then guessed from the filename — which we do not have, since
 *     we upload a Blob. Do not "make these consistent".
 *  2. The top-level `diarization_mode` and `timestamp_granularities` on
 *     TranscriptionConfig are marked @deprecated in the SDK types. The live
 *     fields are the ones nested inside `mode`, which is what this file sends.
 *  3. custom_vocabulary is REJECTED with HTTP 400 alongside either diarization
 *     or timestamps (Google AI forum thread 180240). We never send it. Do not
 *     add speech biasing here without re-testing that combination.
 *
 *  Diarization and word-level timestamps together are confirmed working, and
 *  are requested together: without timestamps the speaker labels have nothing
 *  to attach to. Both features drop Gemini's audio cap from 60 to 30 minutes,
 *  which is what lib/transcription/diarization-policy.ts exists to respect. */

export const GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";

/** A silence at least this long starts a new segment even when the speaker has
 *  not changed. Without it, one person talking for twenty minutes becomes a
 *  single chunk of several thousand words — unreadable in the transcript pane
 *  and useless as a retrieval unit later. Gemini gives word offsets and no
 *  punctuation offsets, so a pause is the only sentence boundary on offer. */
const SEGMENT_GAP_SECONDS = 2.5;

interface GeminiAnnotation {
  type?: string;
  text?: string;
  speaker?: string;
  start_offset?: string;
  end_offset?: string;
}

interface GeminiContent {
  annotations?: GeminiAnnotation[];
}

interface GeminiStep {
  content?: GeminiContent[];
}

export interface GeminiInteraction {
  output_text?: string;
  steps?: GeminiStep[];
}

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

/** Offsets arrive as protobuf duration strings — "0.450s". A bare number is
 *  accepted too, because the shape is documented loosely enough that it is
 *  cheaper to tolerate than to be surprised by in production. */
export function parseOffsetSeconds(offset: string | undefined): number | null {
  if (!offset) return null;
  const value = Number(offset.endsWith("s") ? offset.slice(0, -1) : offset);
  return Number.isFinite(value) ? value : null;
}

/** Gemini returns WORDS, not segments. Grouping consecutive words that share a
 *  speaker is what turns that into something a transcript pane can render, and
 *  it is the only real logic in this file — which is why it is pure, exported,
 *  and tested without the SDK. */
export function segmentsFromInteraction(
  interaction: GeminiInteraction,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  for (const step of interaction.steps ?? []) {
    for (const content of step.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type !== "word_info") continue;

        const text = annotation.text?.trim();
        const start = parseOffsetSeconds(annotation.start_offset);
        const end = parseOffsetSeconds(annotation.end_offset);

        // A word with no readable timing cannot be placed. Dropping it loses
        // one token; keeping it would put NaN into a jsonb column that
        // note-view-model.ts renders directly.
        if (!text || start === null || end === null) continue;

        const speakerLabel = annotation.speaker ?? null;

        const sameSpeaker = current && current.speakerLabel === speakerLabel;
        const continuous =
          current && start - current.endSeconds < SEGMENT_GAP_SECONDS;

        if (current && sameSpeaker && continuous) {
          current.text += ` ${text}`;
          current.endSeconds = end;
          continue;
        }

        current = { speakerLabel, startSeconds: start, endSeconds: end, text };
        segments.push(current);
      }
    }
  }

  return segments;
}

function transcriptionConfig(diarize: boolean) {
  // Verbatim, not smart: smart mode rewrites disfluencies, and a meeting
  // transcript that quietly edits what somebody said is worse than an untidy
  // one. custom_vocabulary is deliberately absent — see the header.
  if (!diarize) return { mode: { type: "verbatim" as const } };

  return {
    mode: {
      type: "verbatim" as const,
      diarization_mode: "speaker",
      timestamp_granularities: ["word"],
    },
  };
}

export function createGeminiTranscriber(apiKey: string): Transcriber {
  return async ({
    audio,
    mimeType,
    diarize,
  }: TranscribeRequest): Promise<TranscriptionResult> => {
    // Imported lazily so that the pure parser above can be unit-tested without
    // loading the SDK, and so the SDK never reaches a client bundle by
    // accident.
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey });

    // The File API, not inline bytes. A thirty-minute recording is tens of
    // megabytes and would not survive a JSON request body.
    //
    // camelCase `mimeType` here — this is the Files API surface. See header.
    const uploaded = await client.files.upload({
      file: audio,
      config: { mimeType },
    });

    if (!uploaded.uri) {
      throw new Error("Gemini file upload returned no uri");
    }

    const interaction = (await client.interactions.create({
      model: GEMINI_TRANSCRIBE_MODEL,
      // snake_case `mime_type` here — this is the interactions surface.
      input: [{ type: "audio", uri: uploaded.uri, mime_type: mimeType }],
      generation_config: { transcription_config: transcriptionConfig(diarize) },
    })) as GeminiInteraction;

    const rawTranscript = interaction.output_text?.trim() ?? "";
    if (!rawTranscript) {
      // Two very different causes land here, and the message cannot tell them
      // apart: genuinely silent audio, OR the SDK renaming `output_text`, since
      // the cast above erases the real return type. If this fires on audio you
      // can hear, suspect the wire shape before you suspect the microphone —
      // log the raw interaction and compare it against genai.d.ts.
      throw new Error(
        "Gemini returned an empty transcript (silent audio, or output_text moved)",
      );
    }

    const segments = segmentsFromInteraction(interaction);

    return {
      rawTranscript,
      segments,
      // What HAPPENED, not what was asked for. A diarized request that comes
      // back with no speaker labels is a plain transcript, and
      // notes.diarization_enabled must record that rather than the intent.
      diarized: diarize && segments.some((s) => s.speakerLabel !== null),
    };
  };
}
