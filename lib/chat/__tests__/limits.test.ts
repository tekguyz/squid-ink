import { describe, it, expect } from "vitest";
import {
  MAX_MESSAGE_CHARS,
  MAX_HISTORY_TURNS,
  MAX_HISTORY_TOKENS,
  overLengthCap,
  estimateTokens,
  trimHistory,
} from "@/lib/chat/limits";
import type { ChatTurn } from "@/lib/chat/types";

const turn = (i: number, content = `turn ${i}`): ChatTurn => ({
  id: String(i),
  role: i % 2 === 0 ? "user" : "assistant",
  content,
  scope: "this_note",
  citations: [],
  createdAt: new Date(2026, 8, 3, 0, 0, i).toISOString(),
});

describe("overLengthCap", () => {
  it("accepts exactly 4,000 characters", () => {
    expect(MAX_MESSAGE_CHARS).toBe(4000);
    expect(overLengthCap("x".repeat(4000))).toBe(false);
  });

  it("refuses 4,001 characters", () => {
    expect(overLengthCap("x".repeat(4001))).toBe(true);
  });

  it("counts characters, not trimmed characters", () => {
    // A 4,001-character paste that is mostly whitespace still costs tokens to
    // send. Trimming first would let it through.
    expect(overLengthCap(" ".repeat(4001))).toBe(true);
  });
});

describe("estimateTokens", () => {
  it("is four characters to a token, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("trimHistory", () => {
  it("keeps everything when the history is short", () => {
    const turns = [turn(0), turn(1), turn(2)];
    expect(trimHistory(turns)).toEqual(turns);
  });

  it("keeps only the last 20 turns", () => {
    expect(MAX_HISTORY_TURNS).toBe(20);
    const turns = Array.from({ length: 50 }, (_, i) => turn(i));
    const kept = trimHistory(turns);

    expect(kept).toHaveLength(20);
    expect(kept[0].id).toBe("30");
    expect(kept.at(-1)!.id).toBe("49");
  });

  it("drops oldest-first when 20 turns still exceed the token budget", () => {
    expect(MAX_HISTORY_TOKENS).toBe(8000);
    // 2,000 chars ~= 500 tokens each. 20 of them is 10,000 — over budget.
    const turns = Array.from({ length: 20 }, (_, i) =>
      turn(i, "x".repeat(2000)),
    );
    const kept = trimHistory(turns);

    expect(kept.length).toBeLessThan(20);
    // The NEWEST turn survives. Dropping from the wrong end would throw away
    // the context the answer actually needs.
    expect(kept.at(-1)!.id).toBe("19");
    const total = kept.reduce((n, t) => n + estimateTokens(t.content), 0);
    expect(total).toBeLessThanOrEqual(8000);
  });

  it("keeps at least the newest turn even if it alone busts the budget", () => {
    // A single 4,000-char message is 1,000 tokens and fits. But guard the
    // degenerate case anyway: returning [] would send Claude no user message
    // at all, which is a 400 rather than a graceful degradation.
    const turns = [turn(0, "x".repeat(80_000))];
    expect(trimHistory(turns)).toHaveLength(1);
  });

  it("never leaves an assistant turn leading", () => {
    // Anthropic rejects a leading assistant message. Both cuts drop one
    // turn at a time regardless of role, so this is reachable whenever the
    // token budget bites — and it surfaces as the generic error banner.
    const turns = Array.from({ length: 20 }, (_, i) =>
      turn(i, "x".repeat(2000)),
    );
    const kept = trimHistory(turns);

    expect(kept.length).toBeGreaterThan(0);
    expect(kept[0].role).toBe("user");
  });

  it("keeps the newest turn even when it is the only one and is assistant", () => {
    // The guard must not empty the array chasing a user turn that is not
    // there; sending Claude nothing at all is a 400, not a degradation.
    const only = { ...turn(1), role: "assistant" as const };
    expect(trimHistory([only])).toEqual([only]);
  });

  it("handles an empty history", () => {
    expect(trimHistory([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const turns = Array.from({ length: 50 }, (_, i) => turn(i));
    const before = turns.length;
    trimHistory(turns);
    expect(turns).toHaveLength(before);
  });
});
