import { createRef } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TranscriptPane } from "../transcript-pane";
import { mockNote } from "@/lib/mock/note";
import type { Note, ProcessingStatus } from "@/lib/notes/view-types";

function renderPane(note: Note) {
  return render(
    <TranscriptPane
      note={note}
      activeSegmentId={-1}
      showSpeakerLabels
      scrollRef={createRef<HTMLDivElement>()}
    />,
  );
}

const CASES: [ProcessingStatus, string][] = [
  ["local", "This recording has not been uploaded yet."],
  ["uploading", "This recording is waiting to be transcribed."],
  ["analyzing", "This recording is being transcribed now."],
  ["completed", "This recording was transcribed, but contained no speech."],
  ["failed", "The last attempt to transcribe this recording did not finish."],
];

describe("TranscriptPane empty state", () => {
  for (const [status, copy] of CASES) {
    it(`explains why the pane is empty at '${status}'`, () => {
      renderPane({ ...mockNote, segments: [], processingStatus: status });
      expect(screen.getByText(copy)).toBeInTheDocument();
    });
  }

  it("renders the transcript, not the empty state, for 'completed' with segments", () => {
    renderPane({ ...mockNote, processingStatus: "completed" });
    expect(
      screen.queryByText(
        "This recording was transcribed, but contained no speech.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText(mockNote.segments[0].text)).toBeInTheDocument();
  });
});
