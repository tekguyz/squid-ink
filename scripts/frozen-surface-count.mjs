/**
 * The detector behind check-docs check 13.
 *
 * How many App Surfaces are built has one home: the `docs/ROADMAP.md` status
 * line. Two skills copied that number and every copy went stale on its
 * own. This is deliberately narrow — the phrases those copies actually used, not a general "restated fact" detector, which was judged
 * un-greppable (docs/KNOWN_GAPS.md, 2026-09-09). The fixed total, "ten
 * surfaces", is the design file's and does not move, so it is allowed.
 *
 * Patterns use `\s+` between words so a phrase that wraps across lines in
 * Markdown prose still matches.
 */

// "one" is left out: "one is built into the proxy" is ordinary prose, and a
// copied "one of the ten surfaces" is still caught by the first pattern.
const NUMBER = "(?:zero|two|three|four|five|six|seven|eight|nine|ten|\\d+)";
const OF_TEN = "(?:\\s*/\\s*10|\\s+of\\s+(?:the\\s+)?(?:ten|10))";

const PATTERNS = [
  /of\s+the\s+ten\s+surfaces/gi,
  // The original zero-count claim, in every wording it has been copied in.
  /\bnone\s+(?:(?:is|are|was|were)\s+)?built/gi,
  new RegExp(
    `\\b${NUMBER}${OF_TEN}?\\s+(?:surfaces?\\s+)?(?:(?:are|is|were)\\s+)?(?:now\\s+)?built(?![-\\w])`,
    "gi",
  ),
];

/** One hit per line: a copied sentence often trips two patterns at once.
 *  @param {string} text */
export function findFrozenSurfaceCounts(text) {
  const byLine = new Map();
  for (const pattern of PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const line = text.slice(0, m.index).split("\n").length;
      if (!byLine.has(line)) byLine.set(line, { line, phrase: m[0].replace(/\s+/g, " ") });
    }
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}
