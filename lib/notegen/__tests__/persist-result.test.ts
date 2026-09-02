import { describe, it, expect, vi } from "vitest";
import {
  generatedChunkRowsFor,
  persistGeneratedNote,
  type GeneratedNote,
  type NotegenStore,
} from "@/lib/notegen/persist-result";

const NOTE: GeneratedNote = {
  summary: "They agreed to ship the mapping work first.",
  takeaways: ["Mapping ships first", "Billing slips a week"],
  actionItems: ["Dana to draft the sequencing plan"],
};

function storeSpy(overrides: Partial<NotegenStore> = {}) {
  const calls: string[] = [];
  const store: NotegenStore = {
    deleteGeneratedChunks: vi.fn(async () => {
      calls.push("delete");
    }),
    insertChunks: vi.fn(async () => {
      calls.push("insert");
    }),
    completeNotegen: vi.fn(async () => {
      calls.push("complete");
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
      note: { summary: "   ", takeaways: ["", "  ", "real"], actionItems: [] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("real");
    expect(rows[0].metadata.n).toBe("01");
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
    expect(calls).toEqual(["delete", "insert", "complete"]);
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
      note: { summary: null, takeaways: [], actionItems: [] },
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
