import { describe, it, expect } from "vitest";
import {
  buildTranscriptBlock,
  flattenHistory,
  THIS_NOTE_SYSTEM,
  ALL_NOTES_SYSTEM,
  type NoteContext,
} from "@/lib/chat/context";
import type { ChatTurn } from "@/lib/chat/types";

const ctx = (over: Partial<NoteContext> = {}): NoteContext => ({
  rawTranscript: "Alice: we should raise the price.",
  segments: [
    { seq: 1, time: "00:00", speaker: "Alice", text: "we should raise it" },
    { seq: 8, time: "04:12", speaker: "Bob", text: "by how much though" },
  ],
  summary: ["Pricing was discussed."],
  takeaways: ["Raise the price."],
  actionItems: ["Bob to model the change."],
  ...over,
});

const turn = (
  role: "user" | "assistant",
  content: string,
  scope: ChatTurn["scope"] = "this_note",
): ChatTurn => ({
  id: Math.random().toString(),
  role,
  content,
  scope,
  citations: [],
  createdAt: "2026-09-03T00:00:00.000Z",
});

describe("buildTranscriptBlock", () => {
  it("numbers each segment so Claude has a stable id to cite", () => {
    const block = buildTranscriptBlock(ctx());
    expect(block).toContain("[1] 00:00 Alice:");
    expect(block).toContain("[8] 04:12 Bob:");
  });

  it("is byte-stable across calls — nothing volatile may enter it", () => {
    // The cache is a prefix match. A timestamp, a turn counter or a random id
    // anywhere in this block means cache_read_input_tokens is zero forever
    // and the 5-minute breakpoint buys nothing.
    expect(buildTranscriptBlock(ctx())).toBe(buildTranscriptBlock(ctx()));
  });

  it("works with NO generated notes at all", () => {
    // The whole point of the single-note path: it depends on the transcript
    // and nothing else. notegen may be null, 'generating' or 'failed'.
    const block = buildTranscriptBlock(
      ctx({ summary: [], takeaways: [], actionItems: [] }),
    );
    expect(block).toContain("[1] 00:00 Alice:");
    expect(block.length).toBeGreaterThan(0);
  });

  it("falls back to the raw transcript when there are no segments", () => {
    // An undiarized note has a transcript but no segments. Answering from it
    // beats answering from nothing.
    const block = buildTranscriptBlock(ctx({ segments: [] }));
    expect(block).toContain("Alice: we should raise the price.");
  });

  it("includes generated notes when they exist", () => {
    const block = buildTranscriptBlock(ctx());
    expect(block).toContain("Raise the price.");
    expect(block).toContain("Bob to model the change.");
  });

  it("never mentions notegen status", () => {
    const block = buildTranscriptBlock(ctx());
    expect(block).not.toMatch(/notegen|generating|failed/i);
  });
});

describe("flattenHistory", () => {
  it("keeps role and content and nothing else", () => {
    const flat = flattenHistory([turn("user", "hi"), turn("assistant", "hey")]);
    expect(flat).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hey" },
    ]);
  });

  it("carries no tool scaffolding from an all-notes turn", () => {
    // A thread that ran all-notes turns and then switches to this-note must
    // not carry tool blocks forward, and vice versa. Flattening to plain text
    // is what makes "re-derive per turn" true rather than aspirational.
    const flat = flattenHistory([
      turn("user", "what did we say about pricing", "all_notes"),
      turn("assistant", "You raised it [[cite:c1]].", "all_notes"),
      turn("user", "and in this meeting?", "this_note"),
    ]);

    expect(flat.every((m) => typeof m.content === "string")).toBe(true);
    expect(JSON.stringify(flat)).not.toContain("tool");
    expect(JSON.stringify(flat)).not.toContain("searchNotes");
  });

  it("leaves citation markers in the text", () => {
    // They are prose to Claude and data to the renderer. Stripping them here
    // would make the model think its earlier answer had no sources.
    const [, assistant] = flattenHistory([
      turn("user", "q"),
      turn("assistant", "yes [[cite:t8]]."),
    ]);
    expect(assistant.content).toContain("[[cite:t8]]");
  });

  it("drops a blank turn rather than sending an empty message", () => {
    const flat = flattenHistory([turn("user", "  "), turn("assistant", "hi")]);
    expect(flat).toEqual([{ role: "assistant", content: "hi" }]);
  });
});

describe("system prompts", () => {
  it("tells Claude not to answer from general knowledge on an empty search", () => {
    // Genuinely-empty retrieval is a normal answer, not an error — but only
    // if Claude says so instead of filling the gap.
    expect(ALL_NOTES_SYSTEM).toMatch(/general knowledge/i);
    expect(ALL_NOTES_SYSTEM).toMatch(/\[\[cite:c/);
  });

  it("teaches the this-note marker form and not the cross-note one", () => {
    expect(THIS_NOTE_SYSTEM).toMatch(/\[\[cite:t/);
    expect(THIS_NOTE_SYSTEM).not.toMatch(/\[\[cite:c/);
  });

  it("names no brand", () => {
    for (const s of [THIS_NOTE_SYSTEM, ALL_NOTES_SYSTEM]) {
      expect(s).not.toMatch(/squid|ink/i);
    }
  });
});
