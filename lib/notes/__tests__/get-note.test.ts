import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChunkRow, NoteRow } from "../types";

const NOTE_ID = "11111111-1111-4111-8111-111111111111";

type Result<T> = { data: T; error: { message: string } | null };

/** Stubs the two query chains getNote builds:
 *    .from("notes").select(...).eq(...).maybeSingle()
 *    .from("note_chunks").select(...).eq(...).returns()
 *  Both chains are thenable at the end, so awaiting either resolves. */
function stubClient(notes: Result<NoteRow | null>, chunks: Result<ChunkRow[] | null>) {
  const from = vi.fn((table: string) => {
    const result = table === "notes" ? notes : chunks;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve(result),
      returns: () => Promise.resolve(result),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  });
  return { from };
}

const client = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client.current,
}));

const { getNote } = await import("../get-note");

const noteRow: NoteRow = {
  id: NOTE_ID,
  user_id: "79db5c35-8d50-41c9-a265-49b786994455",
  title: "Pilot pricing & rollout",
  processing_status: "completed",
  raw_transcript: "…",
  diarization_enabled: true,
  audio_duration_seconds: 2467,
  audio_storage_path: null,
  created_at: "2026-08-26T14:00:00Z",
  updated_at: "2026-08-26T14:00:00Z",
};

const segment: ChunkRow = {
  id: "chunk-1",
  note_id: NOTE_ID,
  user_id: noteRow.user_id,
  chunk_type: "transcript_segment",
  content: "First turn.",
  embedding: null,
  metadata: {
    seq: 1,
    ts_start: "00:12",
    speaker: { name: "Priya Raghavan", initials: "PR", token: "speaker-1" },
  },
  created_at: "2026-08-26T14:00:00Z",
};

describe("getNote", () => {
  beforeEach(() => {
    client.current = null;
  });

  it("returns null when no row matches the id", async () => {
    client.current = stubClient({ data: null, error: null }, { data: [], error: null });
    await expect(getNote(NOTE_ID)).resolves.toBeNull();
  });

  it("returns null when the row belongs to someone else", async () => {
    // RLS filters the row out, so this is indistinguishable from not-found —
    // by design. getNote must not surface it as an error.
    client.current = stubClient({ data: null, error: null }, { data: [], error: null });
    await expect(getNote(NOTE_ID)).resolves.toBeNull();
  });

  it("throws when the note query itself errors", async () => {
    client.current = stubClient(
      { data: null, error: { message: "connection reset" } },
      { data: [], error: null },
    );
    await expect(getNote(NOTE_ID)).rejects.toThrow(/connection reset/);
  });

  it("throws when the chunk query errors", async () => {
    client.current = stubClient(
      { data: noteRow, error: null },
      { data: null, error: { message: "chunk boom" } },
    );
    await expect(getNote(NOTE_ID)).rejects.toThrow(/chunk boom/);
  });

  it("assembles a Note when the row and its chunks exist", async () => {
    client.current = stubClient({ data: noteRow, error: null }, { data: [segment], error: null });

    const note = await getNote(NOTE_ID);

    expect(note?.id).toBe(NOTE_ID);
    expect(note?.title).toBe("Pilot pricing & rollout");
    expect(note?.duration).toBe("41:07");
    expect(note?.segments).toHaveLength(1);
    expect(note?.turnCount).toBe(1);
  });

  it("still returns a Note when the row has no chunks", async () => {
    client.current = stubClient({ data: noteRow, error: null }, { data: null, error: null });

    const note = await getNote(NOTE_ID);

    expect(note?.segments).toEqual([]);
    expect(note?.stats).toEqual([]);
  });
});
