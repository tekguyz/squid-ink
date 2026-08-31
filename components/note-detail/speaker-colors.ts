import type { SpeakerToken } from "@/lib/notes/view-types";

/** Tailwind cannot build class names at runtime, so each speaker token maps to
 *  a static utility here. The colours themselves live in app/globals.css. */

export const SPEAKER_TEXT: Record<SpeakerToken, string> = {
  "speaker-1": "text-speaker-1",
  "speaker-2": "text-speaker-2",
  "speaker-3": "text-speaker-3",
};

export const SPEAKER_AVATAR: Record<SpeakerToken, string> = {
  "speaker-1": "bg-speaker-1-avatar text-speaker-1",
  "speaker-2": "bg-speaker-2-avatar text-speaker-2",
  "speaker-3": "bg-speaker-3-avatar text-speaker-3",
};
