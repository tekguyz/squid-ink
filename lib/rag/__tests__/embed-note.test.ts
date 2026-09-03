import { describe, it, expect, vi } from "vitest";
import {
  batchesOf,
  embedChunks,
  embedNoteChunks,
  type EmbedPorts,
} from "@/lib/rag/embed-note";
import { MAX_EMBED_ATTEMPTS, type PendingChunk } from "@/lib/rag/sweep";
import { VoyageError } from "@/lib/rag/voyage-client";
import type { ChunkMetadata } from "@/lib/notes/types";

const vector = (fill: number) => Array.from({ length: 1024 }, () => fill);

function chunk(
  id: string,
  content = `content ${id}`,
  metadata: ChunkMetadata = {},
): PendingChunk {
  return { id, note_id: "note-1", user_id: "user-1", content, metadata };
}

function harness(overrides: Partial<EmbedPorts> = {}) {
  const written = new Map<string, number[]>();
  const recorded = new Map<string, ChunkMetadata>();
  const embed = vi.fn(async (texts: string[]) => texts.map(() => vector(0.5)));

  const ports: EmbedPorts = {
    log: vi.fn(),
    embed,
    writeEmbedding: vi.fn(async (id: string, v: number[]) => {
      written.set(id, v);
      return true;
    }),
    recordAttempt: vi.fn(async (id: string, metadata: ChunkMetadata) => {
      recorded.set(id, metadata);
    }),
    listPendingForNote: vi.fn(async () => []),
    ...overrides,
  };

  return { ports, written, recorded, embed };
}

describe("batchesOf", () => {
  it("puts a small note in one batch — one Voyage call per note is the point", () => {
    const batches = batchesOf([chunk("a"), chunk("b"), chunk("c")]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it("splits on the text-count cap", () => {
    const many = Array.from({ length: 300 }, (_, i) => chunk(`c${i}`));
    const batches = batchesOf(many);
    expect(batches.every((b) => b.length <= 128)).toBe(true);
    expect(batches.flat()).toHaveLength(300);
  });

  it("splits on the token cap even when the count is small", () => {
    // 4 chars per estimated token, so 240,000 chars is ~60,000 tokens each.
    const huge = [
      chunk("a", "x".repeat(240_000)),
      chunk("b", "x".repeat(240_000)),
    ];
    expect(batchesOf(huge)).toHaveLength(2);
  });

  it("never drops a single over-sized chunk on the floor", () => {
    const monster = [chunk("a", "x".repeat(2_000_000))];
    const batches = batchesOf(monster);
    expect(batches).toHaveLength(1);
    expect(batches[0][0].id).toBe("a");
  });

  it("returns nothing for nothing", () => {
    expect(batchesOf([])).toEqual([]);
  });
});

describe("embedChunks — the happy path", () => {
  it("embeds a note's chunks in ONE call and writes each vector back", async () => {
    const { ports, written, embed } = harness();
    const report = await embedChunks(ports, [chunk("a"), chunk("b")]);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][0]).toEqual(["content a", "content b"]);
    expect(written.get("a")).toHaveLength(1024);
    expect(written.get("b")).toHaveLength(1024);
    expect(report.embedded).toBe(2);
    expect(report.exhausted).toBe(0);
  });

  it("counts a lost write as contended, not as a failure", async () => {
    const { ports } = harness({ writeEmbedding: vi.fn(async () => false) });
    const report = await embedChunks(ports, [chunk("a")]);

    expect(report.contended).toBe(1);
    expect(report.embedded).toBe(0);
    expect(ports.recordAttempt).not.toHaveBeenCalled();
  });

  it("does nothing at all for a note with no pending chunks", async () => {
    const { ports, embed } = harness();
    const report = await embedChunks(ports, []);
    expect(embed).not.toHaveBeenCalled();
    expect(report).toEqual({
      embedded: 0,
      blank: 0,
      exhausted: 0,
      retryable: 0,
      contended: 0,
    });
  });
});

describe("embedChunks — the blank guard", () => {
  it("takes a whitespace chunk terminal WITHOUT a Voyage call", async () => {
    const { ports, recorded, embed } = harness();
    const report = await embedChunks(ports, [chunk("blank", "  \n\t ")]);

    expect(embed).not.toHaveBeenCalled();
    expect(report.blank).toBe(1);
    expect(recorded.get("blank")?.embed_attempts).toBe(MAX_EMBED_ATTEMPTS);
  });

  it("does not let a blank chunk hold up its healthy siblings", async () => {
    const { ports, written, embed } = harness();
    const report = await embedChunks(ports, [
      chunk("blank", "   "),
      chunk("good"),
    ]);

    expect(embed.mock.calls[0][0]).toEqual(["content good"]);
    expect(written.has("good")).toBe(true);
    expect(report.embedded).toBe(1);
    expect(report.blank).toBe(1);
  });
});

describe("embedChunks — the batch fallback", () => {
  it("retries INDIVIDUALLY when the batch call fails, so one poison chunk does not cost its siblings their attempt", async () => {
    const embed = vi.fn(async (texts: string[]) => {
      if (texts.length > 1) throw new VoyageError("batch 400", "content", 400);
      if (texts[0] === "content poison") {
        throw new VoyageError("bad", "content", 400);
      }
      return texts.map(() => vector(0.5));
    });

    const { ports, written, recorded } = harness({ embed });
    const report = await embedChunks(ports, [
      chunk("poison", "content poison"),
      chunk("good"),
    ]);

    expect(written.has("good")).toBe(true);
    expect(report.embedded).toBe(1);
    // The healthy sibling's counter is untouched — it never failed on its own.
    expect(recorded.has("good")).toBe(false);
    expect(recorded.get("poison")?.embed_attempts).toBe(1);
  });

  it("increments to the cap and reports exhausted on the third individual failure", async () => {
    const embed = vi.fn(async () => {
      throw new VoyageError("bad", "content", 400);
    });
    const { ports, recorded } = harness({ embed });

    const report = await embedChunks(ports, [
      chunk("poison", "content poison", { embed_attempts: 2 }),
    ]);

    expect(recorded.get("poison")?.embed_attempts).toBe(MAX_EMBED_ATTEMPTS);
    expect(report.exhausted).toBe(1);
  });

  it("does NOT increment on a transient failure — a rate limit is not the chunk's fault", async () => {
    const embed = vi.fn(async () => {
      throw new VoyageError("429", "transient", 429);
    });
    const { ports, recorded } = harness({ embed });

    const report = await embedChunks(ports, [chunk("a")]);

    expect(ports.recordAttempt).not.toHaveBeenCalled();
    expect(recorded.size).toBe(0);
    expect(report.retryable).toBe(1);
    expect(report.exhausted).toBe(0);
  });

  it("does NOT fan a transient batch failure out into one call per chunk", async () => {
    // A 429 or a 5xx says nothing about any individual text, so retrying each
    // member alone cannot produce a different answer — it only multiplies one
    // failed request into 1 + N against the very limit that rejected it.
    const embed = vi.fn(async () => {
      throw new VoyageError("429", "transient", 429);
    });
    const { ports } = harness({ embed });

    const report = await embedChunks(ports, [
      chunk("a"),
      chunk("b"),
      chunk("c"),
    ]);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(ports.recordAttempt).not.toHaveBeenCalled();
    expect(report.retryable).toBe(3);
    expect(report.exhausted).toBe(0);
  });

  it("ABORTS the whole run on a fatal error rather than burning every counter", async () => {
    const embed = vi.fn(async () => {
      throw new VoyageError("401", "fatal", 401);
    });
    const { ports } = harness({ embed });

    await expect(embedChunks(ports, [chunk("a"), chunk("b")])).rejects.toThrow(
      /401/,
    );
    expect(ports.recordAttempt).not.toHaveBeenCalled();
  });

  it("treats a non-Voyage throw as content evidence, so it cannot loop forever", async () => {
    const embed = vi.fn(async () => {
      throw new Error("something else broke");
    });
    const { ports, recorded } = harness({ embed });

    const report = await embedChunks(ports, [chunk("a")]);
    expect(recorded.get("a")?.embed_attempts).toBe(1);
    expect(report.exhausted).toBe(0);
  });

  it("merges the failure into existing metadata rather than replacing it", async () => {
    const embed = vi.fn(async () => {
      throw new VoyageError("bad", "content", 400);
    });
    const { ports, recorded } = harness({ embed });

    await embedChunks(ports, [chunk("a", "hi", { seq: 7, ts_start: "00:03" })]);

    expect(recorded.get("a")).toMatchObject({
      seq: 7,
      ts_start: "00:03",
      embed_attempts: 1,
    });
  });
});

describe("embedNoteChunks", () => {
  it("lists the note's pending chunks and embeds them", async () => {
    const { ports, written } = harness({
      listPendingForNote: vi.fn(async () => [chunk("a"), chunk("b")]),
    });

    const report = await embedNoteChunks(ports, "note-1");

    expect(ports.listPendingForNote).toHaveBeenCalledWith(
      "note-1",
      expect.any(Number),
    );
    expect(written.size).toBe(2);
    expect(report.embedded).toBe(2);
  });

  it("spends no Voyage call when the note is already fully embedded", async () => {
    const { ports, embed } = harness({
      listPendingForNote: vi.fn(async () => []),
    });
    const report = await embedNoteChunks(ports, "note-1");
    expect(embed).not.toHaveBeenCalled();
    expect(report.embedded).toBe(0);
  });
});
