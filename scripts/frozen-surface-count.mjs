/**
 * The detector behind check-docs check 13.
 *
 * How many App Surfaces are built has one home: the `docs/ROADMAP.md` status
 * line. Skills and rule files copied that number three times and every copy went
 * stale on its own. This is deliberately narrow — the phrases those copies
 * actually used, not a general "restated fact" detector, which was judged
 * un-greppable (docs/KNOWN_GAPS.md, 2026-09-09). The fixed total, "ten
 * surfaces", is the design file's and does not move, so it is allowed.
 *
 * Patterns use `\s+` between words so a phrase that wraps across lines in
 * Markdown prose still matches.
 */

const NUMBER = "(?:one|two|three|four|five|six|seven|eight|nine|ten|\\d+)";

const PATTERNS = [
  /of\s+the\s+ten\s+surfaces/gi,
  /none\s+is\s+built/gi,
  new RegExp(
    `\\b${NUMBER}\\s+(?:of\\s+the\\s+(?:ten|10)\\s+)?(?:surfaces?\\s+)?(?:(?:are|is|were)\\s+)?(?:now\\s+)?built(?![-\\w])`,
    "gi",
  ),
];

/** @param {string} text */
export function findFrozenSurfaceCounts(text) {
  const hits = [];
  const seen = new Set();
  for (const pattern of PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      if (seen.has(m.index)) continue;
      seen.add(m.index);
      hits.push({
        line: text.slice(0, m.index).split("\n").length,
        phrase: m[0].replace(/\s+/g, " "),
      });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}
