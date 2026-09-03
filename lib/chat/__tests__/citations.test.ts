import { describe, it, expect } from "vitest";
import { citationsFromSteps } from "@/lib/chat/citations";

const result = (over: Record<string, unknown> = {}) => ({
  n: 1,
  citeKey: "c1",
  chunkId: "ch-1",
  noteId: "n-1",
  noteTitle: "Pricing sync",
  chunkType: "transcript_segment",
  tsStart: "04:12",
  ...over,
});

const step = (results: unknown[]) => ({
  toolResults: [{ toolName: "searchNotes", output: { results } }],
});

describe("citationsFromSteps", () => {
  it("builds one citation per returned result", () => {
    expect(citationsFromSteps([step([result()])])).toEqual([
      {
        key: "c1",
        chunkId: "ch-1",
        noteId: "n-1",
        noteTitle: "Pricing sync",
        chunkType: "transcript_segment",
        tsStart: "04:12",
      },
    ]);
  });

  it("returns an empty array when no tool ran — the this-note path", () => {
    expect(citationsFromSteps([{ toolResults: [] }])).toEqual([]);
    expect(citationsFromSteps([])).toEqual([]);
  });

  it("keeps the FIRST result for a repeated key across two searches", () => {
    // Claude may search twice in one turn, and each call restarts its own
    // numbering at c1. The earlier result is the one the earlier prose cites,
    // so a later c1 must not overwrite it.
    const got = citationsFromSteps([
      step([result({ chunkId: "a" })]),
      step([result({ chunkId: "b" })]),
    ]);

    expect(got).toHaveLength(1);
    expect(got[0].chunkId).toBe("a");
  });

  it("carries a null title through rather than inventing one", () => {
    const [got] = citationsFromSteps([step([result({ noteTitle: null })])]);
    expect(got.noteTitle).toBeNull();
  });

  it("survives a malformed tool result without throwing", () => {
    // This runs in onFinish, AFTER the answer has streamed. Throwing here
    // would lose a persisted message over a shape mismatch.
    expect(citationsFromSteps([{ toolResults: [{ output: null }] }])).toEqual([]);
    expect(citationsFromSteps([{}])).toEqual([]);
    expect(citationsFromSteps([step([{ citeKey: "c1" }])])).toEqual([]);
    expect(citationsFromSteps([step("not an array" as unknown as [])])).toEqual(
      [],
    );
  });
});
