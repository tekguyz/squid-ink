import { describe, it, expect, vi } from "vitest";
import {
  embeddingSweep,
  EMBED_CHUNK_WINDOW,
  MAX_EMBED_NOTES_PER_RUN,
  type EmbeddingPorts,
  type PendingChunk,
} from "@/lib/rag/sweep";

const vector = (fill: number) => Array.from({ length: 1024 }, () => fill);

function chunk(id: string, noteId: string): PendingChunk {
  return {
    id,
    note_id: noteId,
    user_id: `user-${noteId}`,
    content: `text ${id}`,
    metadata: {},
  };
}

function harness(pending: PendingChunk[], now = () => 0) {
  const written: string[] = [];
  const embed = vi.fn(async (texts: string[]) => texts.map(() => vector(0.5)));

  const ports: EmbeddingPorts = {
    now,
    log: vi.fn(),
    embed,
    listPending: vi.fn(async () => pending),
    listPendingForNote: vi.fn(async (noteId: string) =>
      pending.filter((c) => c.note_id === noteId),
    ),
    writeEmbedding: vi.fn(async (id: string) => {
      written.push(id);
      return true;
    }),
    recordAttempt: vi.fn(async () => {}),
  };

  return { ports, written, embed };
}

describe("embeddingSweep", () => {
  it("groups pending chunks by note and sends ONE Voyage call per note", async () => {
    const { ports, embed, written } = harness([
      chunk("a1", "note-a"),
      chunk("b1", "note-b"),
      chunk("a2", "note-a"),
    ]);

    const report = await embeddingSweep(ports, { deadlineAt: Infinity });

    expect(embed).toHaveBeenCalledTimes(2);
    expect(report.notes).toBe(2);
    expect(report.embedded).toBe(3);
    expect(written).toHaveLength(3);
  });

  it("asks for a wide enough window to reach the note cap", async () => {
    const { ports } = harness([]);
    await embeddingSweep(ports, { deadlineAt: Infinity });
    expect(ports.listPending).toHaveBeenCalledWith(EMBED_CHUNK_WINDOW);
  });

  it("does not filter by user — crossing every tenant is the whole job", async () => {
    const { ports, embed } = harness([
      chunk("a1", "note-a"),
      chunk("b1", "note-b"),
    ]);
    await embeddingSweep(ports, { deadlineAt: Infinity });
    // One call per note regardless of the two different user_ids.
    expect(embed).toHaveBeenCalledTimes(2);
    expect(ports.listPending).toHaveBeenCalledTimes(1);
  });

  it("stops at the per-run note cap and reports the rest as deferred", async () => {
    const chunks = Array.from({ length: MAX_EMBED_NOTES_PER_RUN + 3 }, (_, i) =>
      chunk(`c${i}`, `note-${i}`),
    );
    const { ports, embed } = harness(chunks);

    const report = await embeddingSweep(ports, { deadlineAt: Infinity });

    expect(report.notes).toBe(MAX_EMBED_NOTES_PER_RUN);
    expect(embed).toHaveBeenCalledTimes(MAX_EMBED_NOTES_PER_RUN);
    expect(report.deferred).toBe(3);
  });

  it("stops claiming new work past the SHARED deadline", async () => {
    const clock = { value: 0 };
    const { ports, embed } = harness(
      [chunk("a1", "note-a"), chunk("b1", "note-b")],
      () => clock.value,
    );
    ports.writeEmbedding = vi.fn(async () => {
      clock.value = 999; // the first note used the whole budget
      return true;
    });

    const report = await embeddingSweep(ports, { deadlineAt: 100 });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(report.notes).toBe(1);
    expect(report.deferred).toBe(1);
  });

  it("returns an all-zero report and spends nothing on a fully embedded table", async () => {
    const { ports, embed } = harness([]);
    const report = await embeddingSweep(ports, { deadlineAt: Infinity });

    expect(embed).not.toHaveBeenCalled();
    expect(report).toEqual({
      notes: 0,
      embedded: 0,
      blank: 0,
      exhausted: 0,
      retryable: 0,
      contended: 0,
      deferred: 0,
    });
  });

  it("rolls each note's counters into the run total", async () => {
    const pending = [
      { ...chunk("blank", "note-a"), content: "   " },
      chunk("good", "note-a"),
    ];
    const { ports } = harness(pending);

    const report = await embeddingSweep(ports, { deadlineAt: Infinity });

    expect(report.blank).toBe(1);
    expect(report.embedded).toBe(1);
    expect(report.notes).toBe(1);
  });

  it("logs when work was pushed aside, and stays quiet when it was not", async () => {
    const { ports } = harness([chunk("a1", "note-a")]);
    await embeddingSweep(ports, { deadlineAt: Infinity });
    expect(ports.log).not.toHaveBeenCalledWith(
      expect.stringContaining("deferred"),
    );
  });
});
