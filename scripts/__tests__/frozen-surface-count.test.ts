import { describe, expect, it } from "vitest";
import { findFrozenSurfaceCounts } from "../frozen-surface-count.mjs";

describe("findFrozenSurfaceCounts", () => {
  it("catches the ROADMAP status-line phrase copied elsewhere", () => {
    const hits = findFrozenSurfaceCounts("Seven of the ten surfaces are built.");
    expect(hits.map((h) => h.phrase)).toContain("of the ten surfaces");
  });

  it("catches the frozen 'none is built' claim, in any case", () => {
    expect(findFrozenSurfaceCounts("**None is built and none was in scope.**")).toHaveLength(1);
  });

  it.each([
    'It said "none built and none in scope" on 2026-09-09',
    "the ten surfaces are none built",
    "none are built yet",
    "Zero surfaces are built.",
  ])("catches the zero count in its other wordings: %s", (text) => {
    expect(findFrozenSurfaceCounts(text)).toHaveLength(1);
  });

  it("reports one hit for a sentence that trips two patterns", () => {
    expect(findFrozenSurfaceCounts("Seven of the ten surfaces are built.")).toHaveLength(1);
  });

  it.each([
    "Four are built.",
    "while six were built",
    "three surfaces built so far",
    "3 surfaces are now built",
    "when three were built and the ROADMAP said so",
    "seven of ten surfaces built",
  ])("catches a literal built count: %s", (text) => {
    expect(findFrozenSurfaceCounts(text)).not.toHaveLength(0);
  });

  it.each([
    ["4 of 10 built", "4 of 10 built"],
    ["3/10 surfaces built", "3/10 surfaces built"],
  ])("reports the whole count, not its tail: %s", (text, phrase) => {
    expect(findFrozenSurfaceCounts(text)[0]?.phrase).toBe(phrase);
  });

  it("catches a phrase that wraps across lines and reports its line", () => {
    const hits = findFrozenSurfaceCounts("intro\nFive of the\n  ten surfaces are done");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ line: 2, phrase: "of the ten surfaces" });
  });

  it.each([
    "`design-reference/App Surfaces.dc.html` holds ten surfaces (01 dashboard,",
    "How many are built changes, and the count does not live here",
    "Read which surfaces are built off the ROADMAP status line",
    "two built-in hooks",
    "the session cookie is built by the proxy; each one is built on demand",
    "one is built into the proxy",
    "a surface the status line does not list as built",
  ])("leaves a pointer or the fixed total alone: %s", (text) => {
    expect(findFrozenSurfaceCounts(text)).toEqual([]);
  });
});
