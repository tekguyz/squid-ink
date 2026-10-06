"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Note } from "@/lib/notes/view-types";
import type { ChatTurn } from "@/lib/chat/types";
import { seedNotePersona, setNotePersona } from "@/app/notes/actions/persona";
import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";
import { TagEntry } from "@/components/tags/tag-entry";
import { CollectionPicker } from "@/components/collections/collection-picker";
import { DemoOffNote, useDemo } from "@/components/demo/demo-mode";
import { ActionItemsTable } from "./action-items-table";
import { AudioPlayer } from "./audio-player";
import { ChatPanel } from "./chat/chat-panel";
import { NoteHeader } from "./note-header";
import { NotegenPending } from "./notegen-pending";
import { PersonaRail } from "./persona-rail";
import { SpeakerInsights } from "./speaker-insights";
import { SummarySection } from "./summary-section";
import { TakeawaysSection } from "./takeaways-section";
import { TranscribeButton } from "./transcribe-button";
import { TranscriptPane } from "./transcript-pane";
import { PaneHideButton, PaneStrip } from "./panes/pane-toggle";
import { LENS_PANE_ID, TRANSCRIPT_PANE_ID, useNotePanes } from "./panes/use-note-panes";
import { NOTE_WRITES_DEMO_OFF } from "@/lib/auth/demo-visitor";
import { HUD_RESERVE_VAR } from "@/components/recorder/hud-safe-margin";

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
  demoQuestionsLeft = null,
}: {
  note: Note;
  history: ChatTurn[];
  /** Issue #19: a demo visitor's remaining questions, or null. */
  demoQuestionsLeft?: number | null;
}) {
  const [activeSegmentId, setActiveSegmentId] = useState(INITIAL_SEGMENT_ID);
  // Counts jumps, so a citation to the segment already active still scrolls
  // to it — in a transcript pane that was hidden a moment ago, say.
  const [jumps, setJumps] = useState(0);
  // The transcription poll's time cap, for the banner that promises text.
  const [pollGaveUp, setPollGaveUp] = useState(false);
  const handleGaveUp = useCallback(() => setPollGaveUp(true), []);
  const panes = useNotePanes(note.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const demo = useDemo();

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

  const { revealTranscript } = panes;
  const handleCitationSelect = useCallback(
    (segmentId: number) => {
      revealTranscript();
      setActiveSegmentId(segmentId);
      setJumps((n) => n + 1);
    },
    [revealTranscript],
  );

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
  }, [activeSegmentId, jumps]);

  return (
    // Issue #23. Each pane's width is a variable the `data-pane-*` attribute
    // on <html> narrows to its 28px strip, so the boot script draws a hidden
    // pane hidden before React loads. Every narrow rule is a max-lg:/max-md:
    // variant: with both panes shown, the drawn desktop grid is unchanged.
    //
    // Below 768px (issue #91) it is one column of three rows: the rail's
    // masthead and lens row, the note, and a HUD_RESERVE band at the bottom
    // that holds the Transcript button on the left while the recorder owns
    // the right. The band replaces the note's own reserve padding there.
    <div
      style={HUD_RESERVE_VAR}
      className="grid h-app grid-cols-[var(--lens-w)_minmax(0,1fr)_var(--transcript-w)] bg-canvas text-ink [--lens-w:136px] [--transcript-w:404px] in-data-[pane-lens=hidden]:[--lens-w:28px] in-data-[pane-transcript=hidden]:[--transcript-w:28px] max-lg:[--transcript-w:28px] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)_var(--hud-reserve)]"
    >
      {/* Inert while the transcript overlay covers it: Tab stays in the
          overlay, and a press here closes the overlay rather than landing on
          a line the reader cannot see. */}
      <div inert={panes.overlay} className="flex min-h-0 min-w-0">
        <PersonaRail
          id={LENS_PANE_ID}
          hidden={!panes.lens.expanded}
          personas={note.personas}
          selectedId={persona.id}
          locked={locked}
          quickActions={persona.actions}
          spansLinked={note.spansLinked}
          onSelect={handlePersonaSelect}
          hideButton={
            <PaneHideButton {...panes.lens} edge="left" />
          }
        />
        <PaneStrip
          {...panes.lens}
          edge="left"
          className="hidden border-r border-rule-strong bg-rail md:in-data-[pane-lens=hidden]:flex"
        />
      </div>

      {/* When the transcript pane is hidden, or below 1024px, it no longer
          owns the HUD's corner, so the note does: the column ends HUD_RESERVE
          above the bottom and the chat never passes under the Record pill. */}
      <main
        inert={panes.overlay}
        style={HUD_RESERVE_VAR}
        className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-rule-strong bg-paper md:in-data-[pane-transcript=hidden]:pb-(--hud-reserve) md:max-lg:pb-(--hud-reserve) max-md:border-r-0"
      >
        <NoteHeader meta={note.meta} title={note.title} />
        {/* Directly under the title, because a tag is a fact about what the
            note IS rather than about its recording — the transport and the
            Transcribe button below are the recording's own facts. This is the
            only place a tag is applied; the rail's chips only filter. */}
        {/* Below 768px the tags, the collection and the demo's reason share
            one wrapping row; above it the wrapper is `contents` and each
            keeps its own line. */}
        <div className="contents max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-[8px] max-md:gap-y-[6px] max-md:px-[16px] max-md:pb-[12px]">
        <TagEntry noteId={note.id} tags={note.tags} />
        {/* Directly under the tags, because both answer "what is this note
            filed under" and a reader looking for one is looking for the other.
            This is the only place a note is filed into a collection — the
            collections rail only navigates. */}
        <CollectionPicker
          noteId={note.id}
          collections={note.collections}
          options={note.collectionOptions}
        />
        {/* Issue #19: the one reason for both fields above. */}
        {demo ? (
          <p className="px-[26px] pb-[13px] max-md:p-0">
            <DemoOffNote id={NOTE_WRITES_DEMO_OFF} className="max-md:text-[11px]" />
          </p>
        ) : null}
        </div>
        {/* Sits with the date/duration meta line, because that is where a
            reader looks for facts about the recording itself. Renders nothing
            when the note has no object. */}
        <AudioPlayer storagePath={note.audioStoragePath} />
        {/* Directly under the transport, because both are facts about the
            recording rather than about its content. Renders nothing once the
            note is 'completed' or 'failed' — see transcribe-button.tsx. */}
        <TranscribeButton
          noteId={note.id}
          status={note.processingStatus}
          notegenStatus={note.notegenStatus}
          onGaveUp={handleGaveUp}
        />

        <div className="scroll-thin min-h-0 flex-1 overflow-auto px-[26px] max-md:px-[16px]">
          <NotegenPending
            processing={note.processingStatus}
            notegen={note.notegenStatus}
            sectionsEmpty={
              note.summary.length === 0 ||
              persona.takeaways.length === 0 ||
              note.actionItems.length === 0
            }
            gaveUp={pollGaveUp}
          />
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
          {/* A plain transcript has one "Unknown" speaker; stats for it would
              be data that does not exist. */}
          {note.hasSpeakerLabels ? <SpeakerInsights stats={note.stats} /> : null}
        </div>

        <ChatPanel
          noteId={note.id}
          personaLabel={persona.name}
          history={history}
          segments={note.segments}
          activeSegmentId={activeSegmentId}
          onCitationSelect={handleCitationSelect}
          demoQuestionsLeft={demoQuestionsLeft}
        />
      </main>

      <div className="flex min-h-0 min-w-0">
        <TranscriptPane
          id={TRANSCRIPT_PANE_ID}
          hidden={!panes.transcript.expanded}
          overlay={panes.overlay}
          note={note}
          activeSegmentId={activeSegmentId}
          scrollRef={scrollRef}
          hideButton={
            <PaneHideButton {...panes.transcript} edge="right" />
          }
        />
        {/* Below 1024px this strip is always there: it is what opens the
            transcript overlay. */}
        <PaneStrip
          {...panes.transcript}
          edge="right"
          className="hidden bg-pane in-data-[pane-transcript=hidden]:flex max-lg:flex"
        />
      </div>
    </div>
  );
}
