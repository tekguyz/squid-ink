import type { Segment } from "@/lib/notes/view-types";
import { SpeakerAvatar } from "./speaker-avatar";
import { SPEAKER_TEXT } from "./speaker-colors";

export interface TranscriptSegmentProps {
  segment: Segment;
  active: boolean;
  showSpeakerLabels: boolean;
}

export function TranscriptSegment({
  segment,
  active,
  showSpeakerLabels,
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
      {showSpeakerLabels ? <SpeakerAvatar speaker={segment.speaker} /> : <span />}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {showSpeakerLabels ? (
            <span className={`text-xs ${SPEAKER_TEXT[segment.speaker.token]}`}>
              {segment.speaker.name}
            </span>
          ) : null}
          <span className="font-mono text-[9.5px] text-meta-4">{segment.time}</span>
        </div>
        <p className="mt-[3px] text-[13px] leading-[1.56] text-pretty text-ink-2">
          {segment.text}
        </p>
      </div>
    </li>
  );
}
