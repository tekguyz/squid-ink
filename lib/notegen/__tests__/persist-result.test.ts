import { describe, it, expect, vi } from "vitest";
import {
  generatedChunkRowsFor,
  persistGeneratedNote,
  normalizeTitle,
  MAX_TITLE_LENGTH,
  type GeneratedNote,
  type NotegenStore,
} from "@/lib/notegen/persist-result";

const NOTE: GeneratedNote = {
  title: "Mapping before billing",
  summary: "They agreed to ship the mapping work first.",
  takeaways: [
    { text: "Mapping ships first", segment: 1 },
    { text: "Billing slips a week", segment: 2 },
  ],
  actionItems: [{ text: "Dana to draft the sequencing plan", segment: 3 }],
};

/** The note's real segment rows, as the store would hand them over. Label 1
 *  resolves to segmentId 0 — the labels are 1-based and the stored seq is not. */
const SEGMENTS = [
  { segmentId: 0, tsStart: "00:12", speaker: "Dana", text: "Mapping first." },
  { segmentId: 1, tsStart: "01:40", speaker: "Ravi", text: "Billing slips." },
  { segmentId: 2, tsStart: null, speaker: "Dana", text: "I'll draft it." },
];

function storeSpy(overrides: Partial<NotegenStore> = {}) {
  const calls: string[] = [];
  const store: NotegenStore = {
    deleteGeneratedChunks: vi.fn(async () => {
      calls.push("delete");
    }),
    insertChunks: vi.fn(async () => {
      calls.push("insert");
    }),
    listSegments: vi.fn(async () => SEGMENTS),
    completeNotegen: vi.fn(async () => {
      calls.push("complete");
      return true;
    }),
    setTitleIfUnset: vi.fn(async () => {
      calls.push("title");
      return true;
    }),
    failNotegen: vi.fn(async () => true),
    ...overrides,
  };
  return { store, calls };
}

describe("generatedChunkRowsFor", () => {
  it("writes persona_id null on every row whatever resolved the config", () => {
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: NOTE,
    });
    expect(rows.every((r) => r.persona_id === null)).toBe(true);
  });

  it("writes embedding null on every row", () => {
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: NOTE,
    });
    expect(rows.every((r) => r.embedding === null)).toBe(true);
  });

  it("emits one summary, then takeaways, then action items", () => {
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: NOTE,
    });
    expect(rows.map((r) => r.chunk_type)).toEqual([
      "summary",
      "takeaway",
      "takeaway",
      "action_item",
    ]);
  });

  it("numbers takeaways from 01 for the rendered ordinal", () => {
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: NOTE,
    });
    const takeaways = rows.filter((r) => r.chunk_type === "takeaway");
    expect(takeaways.map((r) => r.metadata.n)).toEqual(["01", "02"]);
  });

  it("carries note_id and user_id onto every row", () => {
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: NOTE,
    });
    expect(rows.every((r) => r.note_id === "n1" && r.user_id === "u1")).toBe(true);
  });

  it("emits no summary row when the depth produced none", () => {
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: { ...NOTE, summary: null },
    });
    expect(rows.some((r) => r.chunk_type === "summary")).toBe(false);
  });

  it("drops blank entries rather than writing empty chunks", () => {
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: {
        title: null,
        summary: "   ",
        takeaways: [
          { text: "", segment: 1 },
          { text: "  ", segment: 1 },
          { text: "real", segment: 1 },
        ],
        actionItems: [],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("real");
    expect(rows[0].metadata.n).toBe("01");
  });

  it("resolves a 1-based label to the segment's own id and timestamp", () => {
    // The chip is only live because segment_id is on the row. Before this
    // shipped, every generated takeaway fell back to segment 0 / 00:00 and
    // scrolled nowhere — docs/KNOWN_GAPS.md carries the measurement.
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: NOTE,
      segments: SEGMENTS,
    });
    const takeaways = rows.filter((r) => r.chunk_type === "takeaway");
    expect(takeaways[0].metadata).toMatchObject({ segment_id: 0, ts_start: "00:12" });
    expect(takeaways[1].metadata).toMatchObject({ segment_id: 1, ts_start: "01:40" });
  });

  it("writes segment_id with no ts_start when the segment carries none", () => {
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: NOTE,
      segments: SEGMENTS,
    });
    const action = rows.find((r) => r.chunk_type === "action_item")!;
    expect(action.metadata.segment_id).toBe(2);
    expect("ts_start" in action.metadata).toBe(false);
  });

  it("writes no citation when the note has no segments at all", () => {
    // The default: an untranscribed note, or one from before segments were
    // written. It must render exactly as it did — no keys, not null keys.
    const rows = generatedChunkRowsFor({ noteId: "n1", userId: "u1", note: NOTE });
    for (const row of rows) {
      expect("segment_id" in row.metadata).toBe(false);
    }
  });

  it("writes no citation for a label past the end rather than clamping", () => {
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: { ...NOTE, takeaways: [{ text: "orphan", segment: 99 }] },
      segments: SEGMENTS,
    });
    const takeaway = rows.find((r) => r.chunk_type === "takeaway")!;
    expect("segment_id" in takeaway.metadata).toBe(false);
  });

  it("keeps seq and n alongside the citation", () => {
    // n is the rendered ordinal and seq the position within the type. The
    // citation rides beside them; it does not replace either.
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: NOTE,
      segments: SEGMENTS,
    });
    const takeaways = rows.filter((r) => r.chunk_type === "takeaway");
    expect(takeaways[1].metadata).toMatchObject({ seq: 1, n: "02", segment_id: 1 });
  });

  it("writes no owner or due on an action item", () => {
    // ROADMAP §5 keeps action items bare text until the drawer that would edit
    // those fields exists.
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: NOTE,
    });
    const action = rows.find((r) => r.chunk_type === "action_item")!;
    expect(action.metadata.owner).toBeUndefined();
    expect(action.metadata.due).toBeUndefined();
  });
});

describe("persistGeneratedNote", () => {
  it("deletes, inserts, then flips — in that order", async () => {
    const { store, calls } = storeSpy();
    await persistGeneratedNote({
      store,
      noteId: "n1",
      userId: "u1",
      note: NOTE,
    });
    expect(calls).toEqual(["delete", "insert", "title", "complete"]);
  });

  it("still deletes and flips when the model produced nothing usable", async () => {
    // A completed note with zero chunks is a legitimate outcome for a
    // transcript with no decisions in it. Leaving it at 'generating' would
    // hand it to the staleness sweep an hour later for no reason.
    const { store, calls } = storeSpy();
    await persistGeneratedNote({
      store,
      noteId: "n1",
      userId: "u1",
      note: { title: null, summary: null, takeaways: [], actionItems: [] },
    });
    expect(calls).toEqual(["delete", "complete"]);
  });

  it("throws when the flip finds the row is no longer 'generating'", async () => {
    const { store } = storeSpy({ completeNotegen: vi.fn(async () => false) });
    await expect(
      persistGeneratedNote({ store, noteId: "n1", userId: "u1", note: NOTE }),
    ).rejects.toThrow(/no longer 'generating'/);
  });
});

describe("title persistence", () => {
  it("offers the generated title to the store before completing", async () => {
    const { store } = storeSpy();
    await persistGeneratedNote({
      store,
      noteId: "n1",
      userId: "u1",
      note: NOTE,
    });
    expect(store.setTitleIfUnset).toHaveBeenCalledWith(
      "n1",
      "Mapping before billing",
    );
  });

  it("does not write a blank or missing title at all", async () => {
    // Null is what keeps the "Untitled note" fallback rendering. An empty
    // string in the column would render as an empty chip instead.
    const { store } = storeSpy();
    await persistGeneratedNote({
      store,
      noteId: "n1",
      userId: "u1",
      note: { ...NOTE, title: "   " },
    });
    expect(store.setTitleIfUnset).not.toHaveBeenCalled();
  });

  it("still completes when the note was already titled by hand", async () => {
    // setTitleIfUnset returning false means the null-guard refused the write.
    // That is the guard working, not a generation failure.
    const { store } = storeSpy({
      setTitleIfUnset: vi.fn(async () => false),
    });
    await expect(
      persistGeneratedNote({ store, noteId: "n1", userId: "u1", note: NOTE }),
    ).resolves.toEqual({ title: "kept" });
    expect(store.completeNotegen).toHaveBeenCalledWith("n1");
  });

  it("reports what the ROW carries, not what the model returned", async () => {
    // The distinction the function log depends on: a model that returned a
    // title and a row that took one are different facts.
    const { store } = storeSpy();
    await expect(
      persistGeneratedNote({ store, noteId: "n1", userId: "u1", note: NOTE }),
    ).resolves.toEqual({ title: "written" });

    await expect(
      persistGeneratedNote({
        store,
        noteId: "n1",
        userId: "u1",
        note: { ...NOTE, title: null },
      }),
    ).resolves.toEqual({ title: "none" });
  });

  it("collapses whitespace and caps a runaway title", () => {
    expect(normalizeTitle("  Mapping\n  before   billing ")).toBe(
      "Mapping before billing",
    );
    // Cut back to a word boundary, so a chip never ends mid-word.
    const long = normalizeTitle(`${"word ".repeat(60)}end`)!;
    expect(long.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(long.endsWith("word")).toBe(true);

    // One unbroken token has no boundary to find, so a hard slice is the only
    // answer left.
    expect(normalizeTitle("x".repeat(200))?.length).toBe(MAX_TITLE_LENGTH);
    expect(normalizeTitle(null)).toBe(null);
    expect(normalizeTitle("   ")).toBe(null);
  });
});
