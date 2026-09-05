import { describe, it, expect, vi, afterEach } from "vitest";
import { parseAnswer } from "@/components/note-detail/chat/parse-citations";
import type { Citation } from "@/lib/chat/types";

const segments = [
  { id: 1, time: "00:00" },
  { id: 8, time: "04:12" },
];

const cite = (over: Partial<Citation> = {}): Citation => ({
  key: "c1",
  chunkId: "ch-1",
  noteId: "n-1",
  noteTitle: "Pricing sync",
  chunkType: "transcript_segment",
  tsStart: "04:12",
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("parseAnswer — this-note markers", () => {
  it("splits prose around a [[cite:t8]] marker", () => {
    const { runs } = parseAnswer(
      "We raised it [[cite:t8]] last week.",
      [],
      segments,
    );

    expect(runs).toHaveLength(2);
    expect(runs[0].text).toBe("We raised it ");
    expect(runs[0].cite).toEqual({
      kind: "segment",
      segmentId: 8,
      time: "04:12",
    });
    expect(runs[1].text).toBe(" last week.");
    expect(runs[1].cite).toBeUndefined();
  });

  it("drops a segment marker that is not on this page", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runs, resolvedCount } = parseAnswer(
      "Nope [[cite:t99]] here.",
      [],
      segments,
    );

    expect(runs.map((r) => r.text).join("")).toBe("Nope  here.");
    expect(runs.every((r) => r.cite === undefined)).toBe(true);
    expect(resolvedCount).toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});

describe("parseAnswer — cross-note markers", () => {
  it("resolves [[cite:c1]] to a note link", () => {
    const { runs } = parseAnswer("They agreed [[cite:c1]].", [cite()], segments);

    expect(runs[0].cite).toEqual({
      kind: "note",
      noteId: "n-1",
      noteTitle: "Pricing sync",
      label: "Pricing sync 04:12",
    });
  });

  it("labels a structured chunk by type, not by a timestamp it lacks", () => {
    const { runs } = parseAnswer(
      "They agreed [[cite:c1]].",
      [cite({ chunkType: "takeaway", tsStart: null })],
      segments,
    );

    expect(runs[0].cite).toMatchObject({ label: "Pricing sync · Takeaway" });
  });

  it("falls back to 'Untitled note' for a note auto-titling never reached", () => {
    // Auto-titling shipped 2026-09-05 and deliberately does not backfill, so
    // this fallback stays live for every note generated before it.
    const { runs } = parseAnswer(
      "See [[cite:c1]].",
      [cite({ noteTitle: null })],
      segments,
    );

    expect(runs[0].cite).toMatchObject({ noteTitle: "Untitled note" });
  });
});

describe("parseAnswer — the ungrounded floor", () => {
  it("warns on every dropped marker", () => {
    // Silent is right for a malformed marker. It is WRONG when the cause is a
    // deleted chunk or a removed note — the failure must stay visible to
    // whoever is debugging it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseAnswer("a [[cite:c9]] b [[cite:t99]] c", [], segments);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("flags ungrounded when a message's citations ALL fail", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The note was deleted mid-conversation — the exact state
    // scripts/verify-chat-rls.mjs proof 5 leaves behind. Rendering this as a
    // clean answer would make it read as better-sourced than it is.
    const parsed = parseAnswer("They agreed [[cite:c1]].", [], segments);

    expect(parsed.markerCount).toBe(1);
    expect(parsed.resolvedCount).toBe(0);
    expect(parsed.ungrounded).toBe(true);
  });

  it("does NOT flag ungrounded when some citations resolve", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Drawing a warning on a mostly-grounded answer trains it to be ignored.
    const parsed = parseAnswer(
      "One [[cite:c1]] and two [[cite:c9]].",
      [cite()],
      segments,
    );

    expect(parsed.resolvedCount).toBe(1);
    expect(parsed.ungrounded).toBe(false);
  });

  it("does NOT flag ungrounded for an answer with no markers at all", () => {
    // "Nothing in your notes matches that" is a legitimate, correct answer.
    const parsed = parseAnswer(
      "Nothing in your notes matches that.",
      [],
      segments,
    );

    expect(parsed.markerCount).toBe(0);
    expect(parsed.ungrounded).toBe(false);
  });

  it("still returns the prose when everything fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Withholding the answer would be worse than showing it unsourced.
    const parsed = parseAnswer("They agreed [[cite:c1]].", [], segments);
    expect(parsed.runs.map((r) => r.text).join("")).toContain("They agreed");
  });
});

describe("parseAnswer — streaming safety", () => {
  it("leaves a half-arrived marker as plain text rather than eating it", () => {
    // Mid-stream the text can end in "[[cite:c". Consuming it would make the
    // last words of every answer flicker.
    const { runs } = parseAnswer("We agreed [[cite:c", [cite()], segments);
    expect(runs.map((r) => r.text).join("")).toBe("We agreed [[cite:c");
  });

  it("handles an empty string", () => {
    expect(parseAnswer("", [], segments).runs).toEqual([]);
  });

  it("is repeatable — no leaked regex lastIndex between calls", () => {
    // A module-level regex with /g carries lastIndex. Two identical calls
    // returning different answers is the classic symptom, and it only shows
    // up under streaming, where parseAnswer runs on every token.
    const once = parseAnswer("a [[cite:t8]] b", [], segments);
    const twice = parseAnswer("a [[cite:t8]] b", [], segments);
    expect(twice).toEqual(once);
  });
});
