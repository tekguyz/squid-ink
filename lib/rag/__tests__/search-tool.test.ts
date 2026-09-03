import { describe, it, expect, vi } from "vitest";
import {
  searchNotes,
  MAX_SEARCH_RESULTS,
  type SearchPorts,
} from "@/lib/rag/search-tool";

const row = (i: number) => ({
  chunk_id: `chunk-${i}`,
  note_id: `note-${i}`,
  note_title: `Note ${i}`,
  chunk_type: "transcript_segment",
  content: `content ${i}`,
  ts_start: "04:12",
  seq: i,
  score: 1 / (i + 1),
});

const ports = (rows: unknown[]): SearchPorts => ({
  embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
  rpc: vi.fn(async () => rows),
});

describe("searchNotes", () => {
  it("sends the vector as a pgvector text literal, not a JSON array", async () => {
    // The vector crosses PostgREST as JSON.stringify(vector) — pgvector's own
    // text input format. A raw array serialises as a JSON array, which is a
    // different type and is rejected.
    const p = ports([row(1)]);
    await searchNotes("pricing", p);

    expect(p.rpc).toHaveBeenCalledWith("[0.1,0.2,0.3]", "pricing");
  });

  it("embeds the query exactly once", async () => {
    const p = ports([row(1)]);
    await searchNotes("pricing", p);
    expect(p.embedQuery).toHaveBeenCalledTimes(1);
  });

  it("maps snake_case rows to camelCase hits", async () => {
    const p = ports([row(1)]);
    const [hit] = await searchNotes("q", p);

    expect(hit).toEqual({
      chunkId: "chunk-1",
      noteId: "note-1",
      noteTitle: "Note 1",
      chunkType: "transcript_segment",
      content: "content 1",
      tsStart: "04:12",
      seq: 1,
      score: 0.5,
    });
  });

  it("caps at 25 even if the database somehow returns more", async () => {
    // The function's own `limit 25` is the real bound. This is the second one,
    // because "all notes" must never be able to fill a context window no
    // matter what happens on the other side of the RPC.
    expect(MAX_SEARCH_RESULTS).toBe(25);
    const p = ports(Array.from({ length: 40 }, (_, i) => row(i)));
    expect(await searchNotes("q", p)).toHaveLength(25);
  });

  it("returns an empty array for no matches — this is not an error", async () => {
    const p = ports([]);
    await expect(searchNotes("q", p)).resolves.toEqual([]);
  });

  it("tolerates a null title and a null ts_start", async () => {
    // Note auto-titling does not exist, so most rows have a null title. A
    // structured chunk has no timestamp at all.
    const p = ports([
      { ...row(1), note_title: null, ts_start: null, chunk_type: "takeaway" },
    ]);
    const [hit] = await searchNotes("q", p);

    expect(hit.noteTitle).toBeNull();
    expect(hit.tsStart).toBeNull();
  });
});
