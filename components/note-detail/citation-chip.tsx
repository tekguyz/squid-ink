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

const BASE =
  "font-mono text-[10px] cursor-pointer transition-colors " +
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
