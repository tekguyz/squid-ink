// @vitest-environment node
//
// Nothing under lib/transcription/ touches the DOM — it runs in a Vercel
// function, not a browser. The project default is jsdom, whose setup costs
// roughly 75 s per run here and buys this file nothing.
import { describe, it, expect } from "vitest";
import {
  planFor,
  DIARIZATION_MAX_SECONDS,
  PLAIN_MAX_SECONDS,
} from "@/lib/transcription/diarization-policy";

describe("planFor", () => {
  it("diarizes at 27 minutes", () => {
    expect(planFor(27 * 60).kind).toBe("diarized");
  });

  it("diarizes exactly at the 28-minute threshold", () => {
    expect(planFor(28 * 60).kind).toBe("diarized");
    expect(DIARIZATION_MAX_SECONDS).toBe(28 * 60);
  });

  it("drops to plain one second past the threshold", () => {
    expect(planFor(28 * 60 + 1).kind).toBe("plain");
  });

  it("drops to plain at 29 minutes", () => {
    expect(planFor(29 * 60).kind).toBe("plain");
  });

  it("still transcribes plain at Gemini's own 60-minute cap", () => {
    expect(planFor(PLAIN_MAX_SECONDS).kind).toBe("plain");
    expect(PLAIN_MAX_SECONDS).toBe(60 * 60);
  });

  it("refuses one second past the 60-minute cap", () => {
    const plan = planFor(PLAIN_MAX_SECONDS + 1);
    expect(plan.kind).toBe("too-long");
    if (plan.kind !== "too-long") throw new Error("unreachable");
    expect(plan.reason).toContain("3601");
  });

  it("falls back to plain when the duration is unknown", () => {
    const plan = planFor(null);
    expect(plan.kind).toBe("plain");
    if (plan.kind !== "plain") throw new Error("unreachable");
    expect(plan.reason).toContain("unknown");
  });

  it("treats a zero or negative duration as unknown, not as diarizable", () => {
    expect(planFor(0).kind).toBe("plain");
    expect(planFor(-5).kind).toBe("plain");
  });
});
