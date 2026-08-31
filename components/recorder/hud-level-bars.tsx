"use client";

/** The seven-bar mic meter from App Surfaces 02b. Bar heights are a fixed
 *  ladder scaled by the live level — nothing here calls Math.random(), which
 *  this project forbids in a render path. */
const LADDER = [5, 11, 15, 8, 13, 4, 9] as const;

/** Three colour tiers, tallest loudest, matching the design's three greens. */
function tone(height: number): string {
  if (height >= 13) return "bg-accent";
  if (height >= 8) return "bg-tint-hover";
  return "bg-waveform";
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
