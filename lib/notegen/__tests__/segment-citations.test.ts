import { describe, it, expect } from "vitest";
import {
  numberedTranscript,
  resolveSegmentCitation,
  segmentsFromChunks,
  withCitation,
  type NotegenSegment,
} from "@/lib/notegen/segment-citations";
import type { ChunkRow } from "@/lib/notes/types";

function segmentRow(overrides: Partial<ChunkRow> = {}): ChunkRow {
  return {
    id: "c1",
    note_id: "n1",
    user_id: "u1",
    chunk_type: "transcript_segment",
    persona_id: null,
    content: "We ship the mapping work first.",
    embedding: null,
    metadata: { seq: 0, ts_start: "00:12" },
    created_at: "2026-09-16T00:00:00.000Z",
    ...overrides,
  };
}

const SEGMENTS: NotegenSegment[] = [
  { segmentId: 0, tsStart: "00:12", speaker: "Dana", text: "Mapping first." },
  { segmentId: 1, tsStart: "01:40", speaker: null, text: "Billing slips." },
  { segmentId: 2, tsStart: null, speaker: "Rae", text: "Agreed." },
];

describe("segmentsFromChunks", () => {
  it("mirrors note-view-model's seq ?? index + 1 rule", () => {
    // The two must agree row for row. If they ever drift, every citation this
    // pipeline writes points one segment off.
    const rows = [
      segmentRow({ id: "b", metadata: { seq: 1, ts_start: "01:40" } }),
      segmentRow({ id: "a", metadata: { seq: 0, ts_start: "00:12" } }),
    ];
    expect(segmentsFromChunks(rows).map((s) => s.segmentId)).toEqual([0, 1]);
  });

  it("falls back to index + 1 for a row carrying no seq", () => {
    const rows = [segmentRow({ id: "a", metadata: {} })];
    expect(segmentsFromChunks(rows)[0].segmentId).toBe(1);
  });

  it("sorts by seq then id, the same ordering the view model applies", () => {
    const rows = [
      segmentRow({ id: "z", metadata: { seq: 2 }, content: "third" }),
      segmentRow({ id: "a", metadata: { seq: 1 }, content: "second" }),
      segmentRow({ id: "b", metadata: { seq: 1 }, content: "second-tie" }),
    ];
    expect(segmentsFromChunks(rows).map((s) => s.text)).toEqual([
      "second",
      "second-tie",
      "third",
    ]);
  });

  it("carries the speaker name and timestamp off the row", () => {
    const rows = [
      segmentRow({
        metadata: { seq: 0, ts_start: "00:12", speaker: { name: "Dana", initials: "DA", token: "speaker-1" } },
      }),
    ];
    expect(segmentsFromChunks(rows)[0]).toMatchObject({
      speaker: "Dana",
      tsStart: "00:12",
    });
  });

  it("reports a null speaker and a null timestamp rather than inventing either", () => {
    expect(segmentsFromChunks([segmentRow({ metadata: { seq: 0 } })])[0]).toMatchObject({
      speaker: null,
      tsStart: null,
    });
  });
});

describe("numberedTranscript", () => {
  it("labels every line 1-based, whatever the stored segment ids are", () => {
    // THE LABEL IS NOT THE SEGMENT ID. Stored seq starts at 0; the prompt's
    // label starts at 1, so label 1 resolves to seq 0.
    expect(numberedTranscript(SEGMENTS).split("\n")).toEqual([
      "[1] Dana: Mapping first.",
      "[2] Billing slips.",
      "[3] Rae: Agreed.",
    ]);
  });

  it("is empty for a note with no segments", () => {
    expect(numberedTranscript([])).toBe("");
  });
});

describe("resolveSegmentCitation", () => {
  it("resolves a 1-based label to that segment's own id and timestamp", () => {
    expect(resolveSegmentCitation(SEGMENTS, 2)).toEqual({
      segment_id: 1,
      ts_start: "01:40",
    });
  });

  it("omits ts_start when the segment carries none", () => {
    // Absent, not null: note-view-model.ts cannot tell the two apart.
    expect(resolveSegmentCitation(SEGMENTS, 3)).toEqual({ segment_id: 2 });
  });

  it("misses on 0, which is what the prompt asks for when nothing supports a claim", () => {
    expect(resolveSegmentCitation(SEGMENTS, 0)).toBeNull();
  });

  it("misses on null, a non-integer and a label past the end", () => {
    expect(resolveSegmentCitation(SEGMENTS, null)).toBeNull();
    expect(resolveSegmentCitation(SEGMENTS, 1.5)).toBeNull();
    expect(resolveSegmentCitation(SEGMENTS, 4)).toBeNull();
    expect(resolveSegmentCitation(SEGMENTS, -1)).toBeNull();
  });

  it("misses on every label when the note has no segments", () => {
    expect(resolveSegmentCitation([], 1)).toBeNull();
  });

  it("never clamps a near-miss to a neighbouring segment", () => {
    // A manufactured citation looks trustworthy and is not. Missing is right.
    expect(resolveSegmentCitation(SEGMENTS, 99)).toBeNull();
  });
});

describe("withCitation", () => {
  it("merges the citation fields into the metadata", () => {
    expect(withCitation({ seq: 0, n: "01" }, { segment_id: 7, ts_start: "03:31" })).toEqual({
      seq: 0,
      n: "01",
      segment_id: 7,
      ts_start: "03:31",
    });
  });

  it("adds no keys at all on a miss", () => {
    // An explicit null would be a WRITTEN field, and the view model reads
    // absent and null the same way — so writing null would be a lie with a
    // value in it.
    const metadata = withCitation({ seq: 0, n: "01" }, null);
    expect(metadata).toEqual({ seq: 0, n: "01" });
    expect("segment_id" in metadata).toBe(false);
  });
});
