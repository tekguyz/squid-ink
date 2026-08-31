// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  chunkRowsFor,
  persistTranscription,
  type TranscriptionStore,
} from "@/lib/transcription/persist-result";
import type { TranscriptionResult } from "@/lib/transcription/transcript";

const NOTE = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

const diarized: TranscriptionResult = {
  rawTranscript: "Hello there Hi",
  diarized: true,
  segments: [
    { speakerLabel: "spk_1", startSeconds: 0, endSeconds: 1, text: "Hello there" },
    { speakerLabel: "spk_2", startSeconds: 1.2, endSeconds: 1.6, text: "Hi" },
  ],
};

function store(): TranscriptionStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    deleteTranscriptChunks: vi.fn(async () => {
      calls.push("delete");
    }),
    insertChunks: vi.fn(async () => {
      calls.push("insert");
    }),
    completeNote: vi.fn(async () => {
      calls.push("complete");
      return true;
    }),
    markFailed: vi.fn(async () => {
      calls.push("failed");
    }),
  };
}

describe("chunkRowsFor", () => {
  it("writes one transcript_segment row per segment, with embedding null", () => {
    const rows = chunkRowsFor({ noteId: NOTE, userId: USER, result: diarized });

    expect(rows).toHaveLength(2);
    expect(rows[0].note_id).toBe(NOTE);
    expect(rows[0].user_id).toBe(USER);
    expect(rows[0].chunk_type).toBe("transcript_segment");
    expect(rows[0].embedding).toBeNull();
    expect(rows[0].content).toBe("Hello there");
  });

  it("leaves persona_id null — a transcript belongs to no lens", () => {
    const rows = chunkRowsFor({ noteId: NOTE, userId: USER, result: diarized });
    expect(rows.every((r) => r.persona_id === null)).toBe(true);
  });

  it("numbers segments from zero in order", () => {
    const rows = chunkRowsFor({ noteId: NOTE, userId: USER, result: diarized });
    expect(rows.map((r) => r.metadata.seq)).toEqual([0, 1]);
  });

  it("writes ts_start as a display string and the seconds alongside it", () => {
    const rows = chunkRowsFor({ noteId: NOTE, userId: USER, result: diarized });

    expect(rows[1].metadata.ts_start).toBe("00:01");
    expect(rows[1].metadata.ts_end).toBe("00:01");
    expect(rows[1].metadata.ts_start_seconds).toBe(1.2);
    expect(rows[1].metadata.ts_end_seconds).toBe(1.6);
  });

  it("resolves the speaker into a name, initials and a colour token", () => {
    const rows = chunkRowsFor({ noteId: NOTE, userId: USER, result: diarized });

    expect(rows[0].metadata.speaker).toEqual({
      name: "Speaker 1",
      initials: "S1",
      token: "speaker-1",
    });
    expect(rows[1].metadata.speaker?.token).toBe("speaker-2");
  });

  it("omits speaker entirely when nothing was diarized", () => {
    const rows = chunkRowsFor({
      noteId: NOTE,
      userId: USER,
      result: {
        rawTranscript: "One two",
        diarized: false,
        segments: [
          { speakerLabel: null, startSeconds: 0, endSeconds: 2, text: "One two" },
        ],
      },
    });

    expect(rows[0].metadata.speaker).toBeUndefined();
  });

  it("falls back to one whole-transcript chunk when there are no segments", () => {
    // A plain (non-diarized) call returns output_text and no word annotations.
    // Writing zero chunks would leave the transcript pane empty for a note that
    // transcribed perfectly well.
    const rows = chunkRowsFor({
      noteId: NOTE,
      userId: USER,
      result: { rawTranscript: "All of it", diarized: false, segments: [] },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("All of it");
    expect(rows[0].metadata.seq).toBe(0);
    expect(rows[0].metadata.ts_start).toBe("00:00");
  });

  it("writes no rows at all for an empty transcript", () => {
    expect(
      chunkRowsFor({
        noteId: NOTE,
        userId: USER,
        result: { rawTranscript: "   ", diarized: false, segments: [] },
      }),
    ).toEqual([]);
  });
});

describe("persistTranscription", () => {
  it("clears old chunks, inserts, and only then completes the note", async () => {
    const s = store();
    await persistTranscription({ store: s, noteId: NOTE, userId: USER, result: diarized });

    // Order is the whole safety property. If insert dies partway the row is
    // still 'analyzing', and the staleness sweep fails it an hour later —
    // which is why there is no bespoke rollback here.
    expect(s.calls).toEqual(["delete", "insert", "complete"]);
  });

  it("throws if the completing claim is lost, leaving the row for the sweep", async () => {
    const s = store();
    s.completeNote = vi.fn(async () => false);

    await expect(
      persistTranscription({ store: s, noteId: NOTE, userId: USER, result: diarized }),
    ).rejects.toThrow(/no longer/i);
  });

  it("does not insert an empty batch", async () => {
    const s = store();
    await persistTranscription({
      store: s,
      noteId: NOTE,
      userId: USER,
      result: { rawTranscript: "  ", diarized: false, segments: [] },
    });

    expect(s.calls).toEqual(["delete", "complete"]);
  });
});
