import { describe, expect, it } from "vitest";
import { buildNoteViewModel } from "../note-view-model";
import type { ChunkMetadata, ChunkRow, NoteRow } from "../types";

const NOTE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "79db5c35-8d50-41c9-a265-49b786994455";

const row: NoteRow = {
  id: NOTE_ID,
  user_id: USER_ID,
  title: "Pilot pricing & rollout",
  processing_status: "completed",
  raw_transcript: "…",
  diarization_enabled: true,
  audio_duration_seconds: 2467,
  audio_storage_path: null,
  created_at: "2026-08-26T14:00:00Z",
  updated_at: "2026-08-26T14:00:00Z",
};

let seq = 0;
const chunk = (
  chunk_type: ChunkRow["chunk_type"],
  content: string,
  metadata: ChunkMetadata,
): ChunkRow => ({
  id: `chunk-${(seq += 1)}`,
  note_id: NOTE_ID,
  user_id: USER_ID,
  chunk_type,
  content,
  embedding: null,
  metadata,
  created_at: "2026-08-26T14:00:00Z",
});

const PRIYA = { name: "Priya Raghavan", initials: "PR", token: "speaker-1" as const };
const MARCUS = { name: "Marcus Lund", initials: "ML", token: "speaker-2" as const };

const chunks: ChunkRow[] = [
  // Deliberately out of order — metadata.seq must drive the result, not
  // whatever order Postgres happened to return.
  chunk("transcript_segment", "Second turn?", { seq: 2, ts_start: "00:41", speaker: MARCUS }),
  chunk("transcript_segment", "First turn.", { seq: 1, ts_start: "00:12", speaker: PRIYA }),
  chunk("summary", "Alpha. Beta.", {
    seq: 1,
    runs: [
      { text: "Alpha", cite: { time: "00:12", segmentId: 1 } },
      { text: ". Beta", cite: { time: "00:41", segmentId: 2 } },
      { text: "." },
    ],
  }),
  chunk("takeaway", "Takeaway one.", { n: "01", seq: 1, ts_start: "00:12", segment_id: 1 }),
  chunk("takeaway", "Takeaway two.", { n: "02", seq: 2, ts_start: "00:41", segment_id: 2 }),
  chunk("action_item", "Do the thing", {
    seq: 1,
    owner: "P. Raghavan",
    due: "Sep 9",
    ts_start: "00:12",
    segment_id: 1,
  }),
];

describe("buildNoteViewModel", () => {
  const note = buildNoteViewModel(row, chunks);

  it("carries the row's id and title through", () => {
    expect(note.id).toBe(NOTE_ID);
    expect(note.title).toBe("Pilot pricing & rollout");
  });

  it("orders transcript segments by metadata.seq, not row order", () => {
    expect(note.segments.map((s) => s.text)).toEqual(["First turn.", "Second turn?"]);
    expect(note.segments.map((s) => s.id)).toEqual([1, 2]);
    expect(note.segments[0].time).toBe("00:12");
    expect(note.segments[0].speaker).toEqual(PRIYA);
  });

  it("counts turns as the number of transcript segments", () => {
    expect(note.turnCount).toBe(2);
  });

  it("formats duration as mm:ss from audio_duration_seconds", () => {
    expect(note.duration).toBe("41:07");
  });

  it("builds meta from created_at and duration, with no client name", () => {
    expect(note.meta).toBe("Wed 26 Aug 2026 · 41 min");
  });

  it("takes the summary's cite runs from metadata.runs", () => {
    expect(note.summary).toHaveLength(3);
    expect(note.summary[0].cite).toEqual({ time: "00:12", segmentId: 1 });
    expect(note.summary[2].cite).toBeUndefined();
  });

  it("maps action items with owner and due from metadata", () => {
    expect(note.actionItems).toEqual([
      {
        text: "Do the thing",
        owner: "P. Raghavan",
        due: "Sep 9",
        time: "00:12",
        segmentId: 1,
      },
    ]);
  });

  it("fills the default persona from real takeaway chunks", () => {
    expect(note.personas[0].id).toBe("neutral-analyst");
    expect(note.personas[0].takeaways.map((t) => t.text)).toEqual([
      "Takeaway one.",
      "Takeaway two.",
    ]);
  });

  it("appends the three preset personas after the default", () => {
    expect(note.personas).toHaveLength(4);
    expect(note.personas.map((p) => p.id)).toEqual([
      "neutral-analyst",
      "sales-coach",
      "investor",
      "engineering-lead",
    ]);
  });

  it("counts every citation across summary, takeaways and action items", () => {
    // 2 summary runs carry a cite, 2 default-persona takeaways, 9 preset
    // takeaways, 1 action item.
    expect(note.spansLinked).toBe(14);
  });

  it("computes speaker stats rather than reading a stored column", () => {
    expect(note.stats.map((s) => s.speaker.name)).toEqual([
      "Priya Raghavan",
      "Marcus Lund",
    ]);
    expect(note.stats[1].asked).toBe("1");
  });

  it("survives a note with no chunks at all", () => {
    const empty = buildNoteViewModel(row, []);
    expect(empty.segments).toEqual([]);
    expect(empty.turnCount).toBe(0);
    expect(empty.summary).toEqual([]);
    expect(empty.stats).toEqual([]);
  });

  it("falls back cleanly when duration is null", () => {
    const noDuration = buildNoteViewModel({ ...row, audio_duration_seconds: null }, chunks);
    expect(noDuration.duration).toBe("00:00");
    expect(noDuration.meta).toBe("Wed 26 Aug 2026");
  });
});
