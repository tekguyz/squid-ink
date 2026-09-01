"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "@/lib/notes/view-types";
import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActionItemsTable } from "./action-items-table";
import { AudioPlayer } from "./audio-player";
import { ChatComposer } from "./chat-composer";
import { NoteHeader } from "./note-header";
import { PersonaRail } from "./persona-rail";
import { SpeakerInsights } from "./speaker-insights";
import { SummarySection } from "./summary-section";
import { TakeawaysSection } from "./takeaways-section";
import { TranscribeButton } from "./transcribe-button";
import { TranscriptPane } from "./transcript-pane";

/** Segment 8 is the design's default selection. */
const INITIAL_SEGMENT_ID = 8;

/** Leaves the jumped-to segment just below the pane header rather than flush
 *  against it, matching the design's scroll offset. */
const SCROLL_OFFSET = 56;

export function NoteDetailShell({ note }: { note: Note }) {
  const [activeSegmentId, setActiveSegmentId] = useState(INITIAL_SEGMENT_ID);
  const [personaId, setPersonaId] = useState(DEFAULT_PERSONA_ID);
  const scrollRef = useRef<HTMLDivElement>(null);

  const persona =
    note.personas.find((p) => p.id === personaId) ?? note.personas[0];

  const handleCitationSelect = useCallback((segmentId: number) => {
    setActiveSegmentId(segmentId);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(
      `[data-seg="${activeSegmentId}"]`,
    );
    if (!container || !target) return;
    container.scrollTo({
      top: target.offsetTop - container.offsetTop - SCROLL_OFFSET,
      behavior: "smooth",
    });
  }, [activeSegmentId]);

  return (
    <div className="grid h-dvh grid-cols-[136px_minmax(0,1fr)_404px] bg-canvas text-ink">
      <PersonaRail
        personas={note.personas}
        selectedId={persona.id}
        quickActions={persona.actions}
        spansLinked={note.spansLinked}
        onSelect={setPersonaId}
      />

      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-rule bg-paper">
        <NoteHeader meta={note.meta} title={note.title} />
        {/* Sits with the date/duration meta line, because that is where a
            reader looks for facts about the recording itself. Renders nothing
            when the note has no object. */}
        <AudioPlayer storagePath={note.audioStoragePath} />
        {/* Directly under the transport, because both are facts about the
            recording rather than about its content. Renders nothing once the
            note is 'completed' or 'failed' — see transcribe-button.tsx. */}
        <TranscribeButton noteId={note.id} status={note.processingStatus} />

        <div className="min-h-0 flex-1 overflow-auto px-[26px]">
          <SummarySection
            runs={note.summary}
            activeSegmentId={activeSegmentId}
            onCitationSelect={handleCitationSelect}
          />
          <TakeawaysSection
            takeaways={persona.takeaways}
            personaLabel={persona.name}
            activeSegmentId={activeSegmentId}
            onCitationSelect={handleCitationSelect}
          />
          <ActionItemsTable
            items={note.actionItems}
            activeSegmentId={activeSegmentId}
            onCitationSelect={handleCitationSelect}
          />
          <SpeakerInsights stats={note.stats} />
        </div>

        <ChatComposer
          personaLabel={persona.name}
          question={note.sampleExchange.question}
          answer={note.sampleExchange.answer}
          activeSegmentId={activeSegmentId}
          onCitationSelect={handleCitationSelect}
        />
      </main>

      <TranscriptPane
        note={note}
        activeSegmentId={activeSegmentId}
        showSpeakerLabels
        scrollRef={scrollRef}
      />

      <ThemeToggle />
    </div>
  );
}
