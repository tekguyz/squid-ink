"use client";

import type { RefObject } from "react";
import type { Note } from "@/lib/mock/types";
import { TranscriptSegment } from "./transcript-segment";
import { Waveform } from "./waveform";

export interface TranscriptPaneProps {
  note: Note;
  activeSegmentId: number;
  showSpeakerLabels: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
}

export function TranscriptPane({
  note,
  activeSegmentId,
  showSpeakerLabels,
  scrollRef,
}: TranscriptPaneProps) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-pane">
      <div className="border-b border-rule px-[18px] pt-[15px] pb-[11px]">
        <div className="flex items-baseline gap-2">
          <h2 className="font-header text-base font-semibold">Transcript</h2>
          <span className="font-mono text-[9px] text-meta-2">
            {note.turnCount} TURNS
          </span>
          <button
            type="button"
            className="ml-auto cursor-pointer font-mono text-[9px] text-meta-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            SEARCH
          </button>
        </div>

        {!showSpeakerLabels ? (
          <p className="mt-[9px] bg-notice-bg px-[9px] py-[7px] text-[11.5px] leading-[1.5] text-notice">
            Speaker labels unavailable for this recording. Timestamps and source
            spans unaffected.
          </p>
        ) : null}

        <Waveform
          bars={note.waveform}
          playhead={note.playhead}
          duration={note.duration}
        />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto pt-2 pb-5">
        <ol>
          {note.segments.map((segment) => (
            <TranscriptSegment
              key={segment.id}
              segment={segment}
              active={segment.id === activeSegmentId}
              showSpeakerLabels={showSpeakerLabels}
            />
          ))}
        </ol>
      </div>
    </aside>
  );
}
