"use client";

/** The seven-bar mic meter from App Surfaces 02b. Bar heights are a fixed
 *  ladder scaled by the live level — nothing here calls Math.random(), which
 *  this project forbids in a render path. */
const LADDER = [5, 11, 15, 8, 13, 4, 9] as const;

/** Three colour tiers, tallest loudest.
 *
 *  RED, not the design's three greens — changed 2026-09-05. This meter is only
 *  on screen while a recording is running, so it is a state indicator, and
 *  green reads as "connected / all good" everywhere else in software. Red is
 *  the near-universal recording signal, and it now agrees with the live dot
 *  sitting immediately to its left.
 *
 *  One token, three tiers. `--live` is the only red this project has, so the
 *  quieter tiers are opacity steps on it rather than two more tokens invented
 *  for a 2px bar. The alpha is Tailwind's `/n` syntax over the same var(), so
 *  no colour is named here. */
function tone(height: number): string {
  if (height >= 13) return "bg-live";
  if (height >= 8) return "bg-live/70";
  return "bg-live/40";
}

export function HudLevelBars({ level }: { level: number }) {
  const scale = 0.25 + Math.min(1, Math.max(0, level)) * 0.75;
  return (
    <span aria-hidden="true" className="flex h-[15px] items-end gap-[2px]">
      {LADDER.map((height, index) => (
        <span
          key={index}
          className={`w-[2px] ${tone(height)}`}
          style={{ height: `${Math.max(2, Math.round(height * scale))}px` }}
        />
      ))}
    </span>
  );
}
