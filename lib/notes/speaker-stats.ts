import type { Segment, SpeakerStat } from "@/lib/notes/view-types";

/**
 * Speaker stats are computed at read time, never stored. There is no column
 * for them, by decision — the transcript segments are the source of truth,
 * so a stored copy could only ever drift from them.
 */

/** Inspectable on purpose: "how is a filler counted" should be answerable by
 *  reading one line, not by reverse-engineering a regex. */
export const FILLER_WORDS = [
  "you know",
  "sort of",
  "kind of",
  "i mean",
  "basically",
  "actually",
  "right",
  "like",
  "um",
  "uh",
  "er",
] as const;

const FILLER_PATTERN = new RegExp(
  `\\b(?:${FILLER_WORDS.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi",
);

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/**
 * Talk share uses the largest-remainder method so the percentages add up to
 * exactly 100. Rounding each share independently does not: three equal
 * speakers each floor to 33%, and the row silently totals 99%.
 */
function talkShares(wordCounts: number[]): number[] {
  const total = wordCounts.reduce((sum, n) => sum + n, 0);
  if (total === 0) return wordCounts.map(() => 0);

  const exact = wordCounts.map((n) => (n / total) * 100);
  const shares = exact.map(Math.floor);

  let leftover = 100 - shares.reduce((sum, n) => sum + n, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    shares[index] += 1;
    leftover -= 1;
  }

  return shares;
}

/** One row per distinct speaker, in the order they first speak. */
export function computeSpeakerStats(segments: Segment[]): SpeakerStat[] {
  const order: string[] = [];
  const grouped = new Map<string, { speaker: Segment["speaker"]; text: string[] }>();

  for (const segment of segments) {
    const key = segment.speaker.name;
    if (!grouped.has(key)) {
      order.push(key);
      grouped.set(key, { speaker: segment.speaker, text: [] });
    }
    grouped.get(key)!.text.push(segment.text);
  }

  const rows = order.map((key) => {
    const { speaker, text } = grouped.get(key)!;
    const joined = text.join(" ");
    return {
      speaker,
      words: countWords(joined),
      asked: countMatches(joined, /\?/g),
      fillers: countMatches(joined, FILLER_PATTERN),
    };
  });

  const shares = talkShares(rows.map((row) => row.words));

  return rows.map((row, index) => ({
    speaker: row.speaker,
    talk: `${shares[index]}%`,
    asked: String(row.asked),
    fillers: String(row.fillers),
  }));
}
