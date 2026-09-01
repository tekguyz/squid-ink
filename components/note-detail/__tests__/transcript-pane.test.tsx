import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { TranscriptPane } from "../transcript-pane";
import type { Note } from "@/lib/notes/view-types";
import type { ProcessingStatus } from "@/lib/notes/types";

vi.mock("@/app/notes/actions", () => ({ transcribeNote: vi.fn() }));

const base: Note = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Pilot pricing",
  meta: "Wed 26 Aug 2026 · 41 min",
  processingStatus: "completed",
  audioStoragePath: null,
  turnCount: 0,
  duration: "41:07",
  playhead: "00:00",
  spansLinked: 0,
  summary: [],
  actionItems: [],
  stats: [],
  segments: [],
  personas: [],
  waveform: [1, 2, 3],
  sampleExchange: { question: "", answer: [] },
};

function pane(status: ProcessingStatus, segments: Note["segments"] = []) {
  return render(
    <TranscriptPane
      note={{ ...base, processingStatus: status, segments, turnCount: segments.length }}
      activeSegmentId={0}
      showSpeakerLabels
      scrollRef={createRef<HTMLDivElement>()}
    />,
  );
}

const SEGMENT = {
  id: 1,
  time: "00:04",
  speaker: { name: "Speaker 1", initials: "S1", token: "speaker-1" as const },
  text: "So where did we land on the pilot?",
};

/** The empty transcript pane was the one place in the app that said nothing at
 *  all about WHY there is no transcript. It rendered "0 TURNS" and an empty
 *  list, which reads identically for a note still uploading, a note the daily
 *  cron has not reached, and a note that failed. */
describe("TranscriptPane empty state", () => {
  it("offers the transcribe action when the note is still 'uploading'", () => {
    pane("uploading");
    expect(screen.getByRole("button", { name: /transcrib/i })).toBeEnabled();
  });

  it("offers a retry when the note is 'failed'", () => {
    pane("failed");
    expect(screen.getByRole("button", { name: /transcrib/i })).toBeEnabled();
  });

  it("offers nothing while a transcription is already running", () => {
    pane("analyzing");
    expect(screen.queryByRole("button", { name: /transcrib/i })).toBeNull();
  });

  it("offers nothing for a completed note with no segments", () => {
    pane("completed");
    expect(screen.queryByRole("button", { name: /transcrib/i })).toBeNull();
  });

  // "No transcript yet." is true at every status and useful at none of them.
  // A note waiting on the daily cron, a note being transcribed right now, and
  // a recording that captured no speech are three different situations, and
  // the pane was saying the same nine characters for all of them.
  it("says the note is waiting, not merely empty, at 'uploading'", () => {
    pane("uploading");
    expect(screen.getByText(/waiting to be transcribed/i)).toBeVisible();
  });

  it("says a transcription is running at 'analyzing'", () => {
    pane("analyzing");
    expect(screen.getByText(/being transcribed now/i)).toBeVisible();
  });

  it("says the last attempt failed at 'failed'", () => {
    pane("failed");
    expect(screen.getByText(/did not finish/i)).toBeVisible();
  });

  // The silent-microphone case. docs/qa/recorder-manual-test-protocol.md warns
  // a muted mic yields ~2 kbit/s and otherwise looks like a complete success —
  // this is where that lands, and it must not read as a broken page.
  it("says the recording had no speech at 'completed' with no segments", () => {
    pane("completed");
    expect(screen.getByText(/no speech/i)).toBeVisible();
  });

  // The action lives in the EMPTY state. A note that already has turns has a
  // transcript on screen, and an action offering to make another one would be
  // an invitation to overwrite it.
  it("offers nothing once the transcript has turns", () => {
    pane("uploading", [SEGMENT]);
    expect(screen.queryByRole("button", { name: /transcrib/i })).toBeNull();
    expect(screen.getByText(/where did we land/)).toBeVisible();
  });
});
