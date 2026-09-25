import type { Segment } from "@/lib/notes/view-types";
import { SpeakerAvatar } from "./speaker-avatar";
import { SPEAKER_TEXT } from "./speaker-colors";

export interface TranscriptSegmentProps {
  segment: Segment;
  active: boolean;
  /** Note.hasSpeakerLabels. Gemini gives speakers and timestamps together or
   *  not at all (diarization-policy.ts), so a plain turn has neither: its
   *  name would be "Unknown" and its time the view model's "00:00". */
  diarized: boolean;
}

export function TranscriptSegment({
  segment,
  active,
  diarized,
}: TranscriptSegmentProps) {
  return (
    <li
      data-seg={segment.id}
      aria-current={active ? "true" : undefined}
      className={[
        "grid grid-cols-[26px_1fr] gap-2.5 border-l-2 py-[9px] pr-[18px] pb-2.5 pl-3.5",
        active ? "border-accent bg-seg-wash" : "border-transparent",
      ].join(" ")}
    >
      {diarized ? <SpeakerAvatar speaker={segment.speaker} /> : <span />}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {diarized ? (
            <span className={`text-[12px] leading-[16px] ${SPEAKER_TEXT[segment.speaker.token]}`}>
              {segment.speaker.name}
            </span>
          ) : null}
          {diarized ? (
            <span className="font-mono text-[9.5px] text-meta-4">{segment.time}</span>
          ) : null}
        </div>
        <p className="mt-[3px] text-[13px] leading-[1.56] text-pretty text-ink-2">
          {segment.text}
        </p>
      </div>
    </li>
  );
}
