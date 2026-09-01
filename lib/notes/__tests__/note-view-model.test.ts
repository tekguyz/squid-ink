import { describe, expect, it } from "vitest";
import { buildNoteViewModel } from "../note-view-model";
import type { ChunkMetadata, ChunkRow, NoteRow, PersonaRow } from "../types";
import { DEFAULT_PERSONA_ID } from "../default-persona";

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
  persona_id: string | null = null,
): ChunkRow => ({
  id: `chunk-${(seq += 1)}`,
  note_id: NOTE_ID,
  user_id: USER_ID,
  chunk_type,
  persona_id,
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

const personaRow = (slug: string, sortOrder: number): PersonaRow => ({
  id: `id-${slug}`,
  user_id: USER_ID,
  slug,
  name: slug,
  sub: `${slug} sub`,
  depth: "dense",
  quick_actions: [`${slug} action`],
  sort_order: sortOrder,
  created_at: "2026-08-30T00:00:00Z",
  updated_at: "2026-08-30T00:00:00Z",
});

const takeaway = (personaId: string | null, n: number): ChunkRow =>
  chunk("takeaway", `takeaway ${n}`, { seq: n, n: String(n).padStart(2, "0"), ts_start: "00:58", segment_id: 3 }, personaId);

/** The four seeded personas, as rows. Named by slug so the assertions below
 *  read the same as the rail does. */
const PERSONAS: PersonaRow[] = [
  personaRow("neutral-analyst", 0),
  personaRow("sales-coach", 1),
  personaRow("investor", 2),
  personaRow("engineering-lead", 3),
];

describe("buildNoteViewModel", () => {
  const note = buildNoteViewModel(row, chunks, PERSONAS);

  it("carries processing_status through as processingStatus", () => {
    // The Transcribe button branches on this, and renders nothing at all once
    // the note is terminal. A dropped field would silently show the button on
    // a completed note.
    expect(note.processingStatus).toBe("completed");
    expect(
      buildNoteViewModel({ ...row, processing_status: "uploading" }, [], [])
        .processingStatus,
    ).toBe("uploading");
  });

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

  it("renders one persona per row, in the order the rows arrive", () => {
    expect(note.personas).toHaveLength(4);
    expect(note.personas.map((p) => p.id)).toEqual([
      "neutral-analyst",
      "sales-coach",
      "investor",
      "engineering-lead",
    ]);
  });

  it("counts every citation across summary, takeaways and action items", () => {
    // 2 summary runs carry a cite, 2 takeaways (both null-attributed, so
    // both the default persona's), 1 action item. The other three personas
    // have no takeaway chunks in this fixture.
    expect(note.spansLinked).toBe(5);
  });

  it("computes speaker stats rather than reading a stored column", () => {
    expect(note.stats.map((s) => s.speaker.name)).toEqual([
      "Priya Raghavan",
      "Marcus Lund",
    ]);
    expect(note.stats[1].asked).toBe("1");
  });

  it("survives a note with no chunks at all", () => {
    const empty = buildNoteViewModel(row, [], PERSONAS);
    expect(empty.segments).toEqual([]);
    expect(empty.turnCount).toBe(0);
    expect(empty.summary).toEqual([]);
    expect(empty.stats).toEqual([]);
  });

  it("falls back cleanly when duration is null", () => {
    const noDuration = buildNoteViewModel(
      { ...row, audio_duration_seconds: null },
      chunks,
      PERSONAS,
    );
    expect(noDuration.duration).toBe("00:00");
    expect(noDuration.meta).toBe("Wed 26 Aug 2026");
  });
});

describe("persona assembly", () => {
  it("exposes the persona slug as the view id, in the order the rows arrive", () => {
    // The query orders rows by sort_order; the view model must not reorder.
    const note = buildNoteViewModel(row, [], [personaRow("neutral-analyst", 0), personaRow("investor", 1)]);
    expect(note.personas.map((p) => p.id)).toEqual(["neutral-analyst", "investor"]);
  });

  it("maps quick_actions onto actions and carries depth through", () => {
    const note = buildNoteViewModel(row, [], [personaRow("neutral-analyst", 0)]);
    expect(note.personas[0].actions).toEqual(["neutral-analyst action"]);
    expect(note.personas[0].depth).toBe("dense");
  });

  it("gives a null-attributed takeaway to the default persona", () => {
    const note = buildNoteViewModel(row, [takeaway(null, 1)], [
      personaRow(DEFAULT_PERSONA_ID, 0),
      personaRow("investor", 1),
    ]);
    expect(note.personas[0].takeaways).toHaveLength(1);
    expect(note.personas[1].takeaways).toEqual([]);
  });

  it("gives an attributed takeaway to its own persona only", () => {
    const note = buildNoteViewModel(row, [takeaway("id-investor", 1)], [
      personaRow(DEFAULT_PERSONA_ID, 0),
      personaRow("investor", 1),
    ]);
    expect(note.personas[0].takeaways).toEqual([]);
    expect(note.personas[1].takeaways).toHaveLength(1);
  });

  it("falls back to a single default persona when the user has no rows", () => {
    // A new account before its personas are provisioned. The rail must still
    // render, and the takeaways must still land somewhere.
    const note = buildNoteViewModel(row, [takeaway(null, 1)], []);
    expect(note.personas).toHaveLength(1);
    expect(note.personas[0].id).toBe(DEFAULT_PERSONA_ID);
    expect(note.personas[0].takeaways).toHaveLength(1);
  });

  it("still places null-attributed takeaways when no row uses the default slug", () => {
    // A user whose personas were renamed, or provisioned by some path other
    // than the seed. Pre-attribution takeaways must not vanish from the page;
    // they go to the first row in rail order.
    const note = buildNoteViewModel(row, [takeaway(null, 1)], [
      personaRow("investor", 0),
      personaRow("sales-coach", 1),
    ]);
    expect(note.personas[0].takeaways).toHaveLength(1);
    expect(note.personas[1].takeaways).toEqual([]);
    expect(note.spansLinked).toBe(1);
  });

  it("counts every persona's takeaways in spansLinked", () => {
    const note = buildNoteViewModel(row, [takeaway(null, 1), takeaway("id-investor", 1)], [
      personaRow(DEFAULT_PERSONA_ID, 0),
      personaRow("investor", 1),
    ]);
    expect(note.spansLinked).toBe(2);
  });
});

/** The playback surface needs the raw path, not a formatted string — it is the
 *  Storage key the audio is fetched with. */
describe("audioStoragePath", () => {
  it("carries the row's storage path through to the view model", () => {
    const note = buildNoteViewModel(
      { ...row, audio_storage_path: "user-1/note-1" },
      [],
      [],
    );
    expect(note.audioStoragePath).toBe("user-1/note-1");
  });

  it("stays null when the note has no object — the player renders nothing", () => {
    expect(buildNoteViewModel(row, [], []).audioStoragePath).toBeNull();
  });
});
