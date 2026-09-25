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
    "Four are built.",
    "while six were built",
    "three surfaces built so far",
    "3 surfaces are now built",
    "when three were built and the ROADMAP said so",
  ])("catches a literal built count: %s", (text) => {
    expect(findFrozenSurfaceCounts(text)).not.toHaveLength(0);
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
    "a surface the status line does not list as built",
  ])("leaves a pointer or the fixed total alone: %s", (text) => {
    expect(findFrozenSurfaceCounts(text)).toEqual([]);
  });
});
