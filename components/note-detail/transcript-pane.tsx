"use client";

import type { RefObject } from "react";
import type { Note, ProcessingStatus } from "@/lib/notes/view-types";
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

      <div
        ref={scrollRef}
        className="scroll-thin min-h-0 flex-1 overflow-auto pt-2 pb-5"
      >
        {note.segments.length === 0 ? (
          <TranscriptEmptyState note={note} />
        ) : (
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
        )}
      </div>
    </aside>
  );
}

/** Until this shipped, an empty pane said "0 TURNS" and nothing else — which
 *  reads identically for a note waiting on the once-a-day cron, a note being
 *  transcribed right now, a note whose last attempt died, and a recording that
 *  captured no speech at all. Four situations, one blank list.
 *
 *  The pane names the situation and stops there. The action lives on the
 *  shell's meta line (`note-detail-shell.tsx`); re-siting this empty state from
 *  the archived branch on 2026-09-01 deliberately dropped the button it carried
 *  so there is exactly one Transcribe button on the screen. */
const WHY: Record<ProcessingStatus, string> = {
  local: "This recording has not been uploaded yet.",
  uploading: "This recording is waiting to be transcribed.",
  analyzing: "This recording is being transcribed now.",
  // The muted-microphone case, among others.
  // docs/qa/recorder-manual-test-protocol.md warns that a muted mic yields
  // ~2 kbit/s and otherwise looks like a complete success. This is where that
  // lands, and it must not read as a broken page.
  completed: "This recording was transcribed, but contained no speech.",
  failed: "The last attempt to transcribe this recording did not finish.",
};

function TranscriptEmptyState({ note }: { note: Note }) {
  return (
    <div className="px-[18px] pt-[13px]">
      <p className="font-body text-[11.5px] leading-[1.5] text-meta">
        {WHY[note.processingStatus]}
      </p>
    </div>
  );
}
