"use client";

export interface CitationChipProps {
  time: string;
  segmentId: number;
  active: boolean;
  /** "filled" is the tinted chip that sits inline in prose; "bare" is the
   *  plain accent timestamp used at the end of an action-item row. */
  variant?: "filled" | "bare";
  onSelect: (segmentId: number) => void;
}

/** The chip is 10px type set inline in prose, so its box is far under the
 *  24px WCAG 2.2 AA target, and growing the box would grow the line box of
 *  every paragraph that carries one. The target is grown instead by an
 *  invisible ::before, 24px tall and centred, which takes no layout (issue
 *  #10). On adjacent lines two chips' targets can overlap by a few px; the
 *  later chip wins that strip, and `verify-layout.mjs` counts it. */
const HIT_AREA =
  "relative before:absolute before:inset-x-0 before:top-1/2 before:h-6 before:-translate-y-1/2";

const BASE =
  `${HIT_AREA} font-mono text-[10px] cursor-pointer transition-colors ` +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

const FILLED =
  "inline-block px-[5px] py-px mx-0.5 align-[1px] " +
  "bg-tint text-accent-text hover:bg-tint-hover data-[active=true]:bg-tint-hover";

const BARE = "text-accent-pressed hover:underline";

export function CitationChip({
  time,
  segmentId,
  active,
  variant = "filled",
  onSelect,
}: CitationChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-active={active}
      aria-label={`Jump to transcript at ${time}`}
      className={`${BASE} ${variant === "filled" ? FILLED : BARE}`}
      onClick={() => onSelect(segmentId)}
    >
      {time}
    </button>
  );
}
