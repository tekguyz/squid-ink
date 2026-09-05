"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Note } from "@/lib/notes/view-types";
import type { ChatTurn } from "@/lib/chat/types";
import { seedNotePersona, setNotePersona } from "@/app/notes/actions/persona";
import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActionItemsTable } from "./action-items-table";
import { AudioPlayer } from "./audio-player";
import { ChatPanel } from "./chat/chat-panel";
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

/** The window in which a lens can still be chosen.
 *
 *  Mirrors SELECTABLE_STATUSES in app/notes/actions/persona.ts. THIS copy is
 *  UX and that one is enforcement, and they must agree — a divergence here
 *  only produces a control that looks live and is refused, never a write that
 *  slips past the guard. */
const SELECTABLE: ReadonlySet<string> = new Set(["local", "uploading"]);

export function NoteDetailShell({
  note,
  history,
}: {
  note: Note;
  history: ChatTurn[];
}) {
  const [activeSegmentId, setActiveSegmentId] = useState(INITIAL_SEGMENT_ID);
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Frozen the moment generation is committed to. WIDER than "notegenStatus is
  // set": pressing Transcribe leaves notegenStatus null for the whole
  // transcription, and note generation only claims afterwards, so a lens
  // switched in that window would race the claim. The premise of this feature
  // is that the lens shown is the lens that generated the note.
  const locked =
    note.notegenStatus !== null || !SELECTABLE.has(note.processingStatus);

  // Optimistic only. The server value is the authority — this exists so the
  // rail does not sit on the old lens for a round trip, and it is dropped the
  // moment the server answers.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const personaId = pendingId ?? note.personaId ?? DEFAULT_PERSONA_ID;

  const persona =
    note.personas.find((p) => p.id === personaId) ?? note.personas[0];

  // Seed the note's lens on mount, as a REAL write, so the rail never
  // highlights something the database does not hold.
  //
  // NEVER for a frozen note: writing a lens onto a note that already generated
  // under a different one would make the rail lie, which is the exact failure
  // this feature exists to prevent.
  //
  // The ref makes this once per mount rather than once per effect run. React
  // StrictMode double-invokes effects in development and this one writes.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || locked || note.personaId !== null) return;
    seeded.current = true;
    void seedNotePersona(note.id).then((outcome) => {
      // "no-persona" is the account with no personas rows: nothing was written
      // and nothing should be. Only a real write is worth a refresh.
      if (outcome === "written") router.refresh();
    });
  }, [note.id, note.personaId, locked, router]);

  const handlePersonaSelect = useCallback(
    (slug: string) => {
      // The rail already disables its buttons; this is the second half of the
      // same client-side guard, and neither is the enforcing one.
      if (locked) return;
      setPendingId(slug);
      void setNotePersona(note.id, slug).then((outcome) => {
        // Anything but a landed write means the rail is showing something the
        // database does not hold. Drop the optimistic value rather than leave
        // it standing.
        if (outcome !== "written") setPendingId(null);
        router.refresh();
      });
    },
    [locked, note.id, router],
  );

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
        locked={locked}
        quickActions={persona.actions}
        spansLinked={note.spansLinked}
        onSelect={handlePersonaSelect}
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

        <div className="scroll-thin min-h-0 flex-1 overflow-auto px-[26px]">
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

        <ChatPanel
          noteId={note.id}
          personaLabel={persona.name}
          history={history}
          segments={note.segments}
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
