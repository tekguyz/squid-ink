import type { Speaker } from "@/lib/notes/view-types";
import { SPEAKER_AVATAR } from "./speaker-colors";

export function SpeakerAvatar({ speaker }: { speaker: Speaker }) {
  return (
    <span
      aria-hidden
      className={`flex size-[26px] items-center justify-center rounded-full font-mono text-[9.5px] ${SPEAKER_AVATAR[speaker.token]}`}
    >
      {speaker.initials}
    </span>
  );
}
