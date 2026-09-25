import { createRef } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TranscriptPane } from "../transcript-pane";
import { mockNote } from "@/lib/mock/note";
import type { Note } from "@/lib/notes/view-types";

const NOTICE = /No speaker labels or timestamps for this recording/;

function renderPane(note: Note) {
  return render(
    <TranscriptPane
      note={note}
      activeSegmentId={-1}
      scrollRef={createRef<HTMLDivElement>()}
    />,
  );
}

describe("TranscriptPane header", () => {
  // #2: a focusable Search with no handler looked live and did nothing.
  it("renders Search disabled, with a visible reason", () => {
    renderPane(mockNote);
    const search = screen.getByRole("button", { name: /search/i });
    expect(search).toBeDisabled();
    expect(search).toHaveTextContent(/soon/i);
  });

  // #13: the notice is driven by notes.diarization_enabled, never a toggle.
  it("shows the no-speaker-labels notice when the note was not diarized", () => {
    renderPane({ ...mockNote, hasSpeakerLabels: false });
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it("hides the notice and shows speaker names when the note was diarized", () => {
    renderPane({ ...mockNote, hasSpeakerLabels: true });
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(
      screen.getAllByText(mockNote.segments[0].speaker.name).length,
    ).toBeGreaterThan(0);
  });

  it("drops speaker names from every turn when the note was not diarized", () => {
    renderPane({ ...mockNote, hasSpeakerLabels: false });
    expect(
      screen.queryByText(mockNote.segments[0].speaker.name),
    ).not.toBeInTheDocument();
  });

  // The plain path asks Gemini for no timestamps, so every time is the
  // view model's "00:00" fallback. Printing it would be a false timestamp.
  it("drops the time from every turn when the note was not diarized", () => {
    renderPane({ ...mockNote, hasSpeakerLabels: false });
    expect(screen.queryByText(mockNote.segments[0].time)).not.toBeInTheDocument();
  });

  it("keeps the time on every turn when the note was diarized", () => {
    renderPane({ ...mockNote, hasSpeakerLabels: true });
    expect(screen.getByText(mockNote.segments[0].time)).toBeInTheDocument();
  });
});
