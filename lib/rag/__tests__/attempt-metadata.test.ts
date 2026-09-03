import { describe, it, expect } from "vitest";
import {
  attemptsIn,
  withEmbedAttempt,
  MAX_EMBED_ATTEMPTS,
} from "@/lib/rag/sweep";
import type { ChunkMetadata } from "@/lib/notes/types";

/** A real transcript_segment metadata object, exactly as
 *  lib/transcription/persist-result.ts writes it. Nothing here may be lost. */
const TRANSCRIPT_METADATA: ChunkMetadata = {
  seq: 4,
  ts_start: "00:12",
  ts_end: "00:19",
  ts_start_seconds: 12.4,
  ts_end_seconds: 19.1,
  speaker: { name: "Speaker 2", initials: "S2", token: "speaker-2" },
};

describe("attemptsIn", () => {
  it("reads zero for a chunk that has never been tried", () => {
    expect(attemptsIn(TRANSCRIPT_METADATA)).toBe(0);
    expect(attemptsIn({})).toBe(0);
  });

  it("reads the recorded count", () => {
    expect(attemptsIn({ embed_attempts: 2 })).toBe(2);
  });

  it("treats a non-numeric value as zero rather than throwing", () => {
    expect(attemptsIn({ embed_attempts: "2" } as unknown as ChunkMetadata)).toBe(
      0,
    );
  });
});

describe("withEmbedAttempt", () => {
  it("MERGES — it never overwrites the transcript's own metadata", () => {
    const merged = withEmbedAttempt(TRANSCRIPT_METADATA, 1, "voyage 400");

    expect(merged.seq).toBe(4);
    expect(merged.ts_start).toBe("00:12");
    expect(merged.ts_end).toBe("00:19");
    expect(merged.ts_start_seconds).toBe(12.4);
    expect(merged.ts_end_seconds).toBe(19.1);
    expect(merged.speaker).toEqual({
      name: "Speaker 2",
      initials: "S2",
      token: "speaker-2",
    });
    expect(merged.embed_attempts).toBe(1);
    expect(merged.embed_error).toBe("voyage 400");
  });

  it("does not mutate the object it was given", () => {
    const before = JSON.stringify(TRANSCRIPT_METADATA);
    withEmbedAttempt(TRANSCRIPT_METADATA, 3, "x");
    expect(JSON.stringify(TRANSCRIPT_METADATA)).toBe(before);
  });

  it("clamps at the cap, so the eligibility filter can enumerate 0..2", () => {
    expect(withEmbedAttempt({}, 9, "x").embed_attempts).toBe(MAX_EMBED_ATTEMPTS);
  });

  it("truncates a long reason — metadata is not a log", () => {
    const reason = "e".repeat(500);
    expect(withEmbedAttempt({}, 1, reason).embed_error).toHaveLength(200);
  });

  it("replaces the previous reason rather than accumulating history", () => {
    const first = withEmbedAttempt({}, 1, "first");
    const second = withEmbedAttempt(first, 2, "second");
    expect(second.embed_error).toBe("second");
    expect(second.embed_attempts).toBe(2);
  });
});
