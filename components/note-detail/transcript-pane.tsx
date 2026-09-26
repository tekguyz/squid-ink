"use client";

import type { RefObject } from "react";
import { HUD_RESERVE } from "@/components/recorder/hud-safe-margin";
import type { Note, ProcessingStatus } from "@/lib/notes/view-types";
import { TranscriptSegment } from "./transcript-segment";
import { Waveform } from "./waveform";

export interface TranscriptPaneProps {
  note: Note;
  activeSegmentId: number;
  scrollRef: RefObject<HTMLDivElement | null>;
}

export function TranscriptPane({
  note,
  activeSegmentId,
  scrollRef,
}: TranscriptPaneProps) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-pane">
      <div className="border-b border-rule px-[18px] pt-[15px] pb-[11px]">
        <div className="flex items-baseline gap-2">
          <h2 className="font-header text-[16px] leading-[24px] font-semibold">Transcript</h2>
          <span className="font-mono text-[9px] text-meta-2">
            {note.turnCount} TURNS
          </span>
          {/* Disabled, not live: there is no transcript search yet (#29 builds
              search). Same idea and tokens as dashboard-header.tsx's dead
              controls, sized for this header and unframed like the text button
              it replaces: a dimmed label plus a full-strength "Soon" badge.
              Measured on `bg-pane`, built CSS, 2026-09-25: the badge 4.78:1
              light / 5.65:1 dark; the dimmed label 1.66 / 1.83, which is the
              disabled-control exemption the dashboard already relies on. */}
          <button
            type="button"
            disabled
            className="ml-auto flex cursor-not-allowed items-center gap-[6px] font-mono text-[9px] text-faint"
          >
            <span className="opacity-60">SEARCH</span>
            <span className="text-[8.5px] tracking-[0.14em] text-muted uppercase">
              Soon
            </span>
          </button>
        </div>

        {!note.hasSpeakerLabels ? (
          <p className="mt-[9px] bg-notice-bg px-[9px] py-[7px] text-[11.5px] leading-[1.5] text-notice">
            No speaker labels or timestamps for this recording. Recordings over
            28 minutes are transcribed as plain text.
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
                diarized={note.hasSpeakerLabels}
              />
            ))}
          </ol>
        )}
      </div>

      {/* The Record HUD owns this column's bottom-right corner. Padding the
          list only moves the last line; at any other scroll position a line
          still passes under the HUD, so the list ENDS above this band (#58),
          as the Dashboard's feed does. */}
      <div
        aria-hidden="true"
        style={{ height: HUD_RESERVE }}
        className="flex-none border-t border-rule bg-pane"
      />
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
