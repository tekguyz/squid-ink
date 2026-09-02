import { describe, it, expect } from "vitest";
import { planForDepth } from "@/lib/notegen/depth-policy";

describe("planForDepth", () => {
  it("maps brief to low, and to decisions and actions only", () => {
    expect(planForDepth("brief")).toEqual({
      thinkingLevel: "low",
      scope: "decisions-and-actions",
      wantsSummary: false,
    });
  });

  it("maps dense to medium, and to all three at balanced depth", () => {
    expect(planForDepth("dense")).toEqual({
      thinkingLevel: "medium",
      scope: "balanced",
      wantsSummary: true,
    });
  });

  it("maps exhaustive to high, and widens scope rather than length", () => {
    expect(planForDepth("exhaustive")).toEqual({
      thinkingLevel: "high",
      scope: "cross-referenced",
      wantsSummary: true,
    });
  });

  it("falls back to the dense plan for a depth outside the union", () => {
    // The column is checked, so this is unreachable through the database. It
    // is reachable through DEFAULT_PERSONA_FALLBACK drifting, or a future
    // custom-persona phase, and a throw here would kill a whole cron run.
    expect(planForDepth("wide" as never)).toEqual(planForDepth("dense"));
  });

  it("never emits the SCREAMING_CASE enum members", () => {
    // genai.d.ts declares BOTH a lowercase union (the interactions surface,
    // which is the one we call) and a ThinkingLevel enum whose members are
    // "LOW"/"MEDIUM"/"HIGH" (the models.generateContent surface). Sending the
    // wrong casing is a 400 that only shows up live.
    for (const depth of ["brief", "dense", "exhaustive"] as const) {
      const { thinkingLevel } = planForDepth(depth);
      expect(thinkingLevel).toBe(thinkingLevel.toLowerCase());
    }
  });
});
