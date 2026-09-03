"use client";

import type { ChatScope } from "@/lib/chat/types";

const OPTIONS: { value: ChatScope; label: string }[] = [
  { value: "this_note", label: "This note" },
  { value: "all_notes", label: "All notes" },
];

/** Which body of text the next question searches.
 *
 *  A radiogroup rather than two independent buttons: the two are mutually
 *  exclusive and a screen reader should say "1 of 2", not read them as
 *  unrelated controls.
 *
 *  That role carries obligations, and they are honoured here rather than
 *  claimed: arrow keys move the selection, and a ROVING TABINDEX makes the
 *  group one tab stop instead of two. Declaring role="radiogroup" while
 *  leaving the arrows dead is worse than using plain buttons — it promises a
 *  screen-reader user a keyboard model that does not exist. */
export function ScopeToggle({
  value,
  disabled,
  onChange,
}: {
  value: ChatScope;
  disabled: boolean;
  onChange: (scope: ChatScope) => void;
}) {
  const selected = OPTIONS.findIndex((o) => o.value === value);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !back) return;

    event.preventDefault();
    const next =
      (selected + (forward ? 1 : OPTIONS.length - 1)) % OPTIONS.length;
    onChange(OPTIONS[next].value);
  };

  return (
    <div role="radiogroup" aria-label="Search scope" className="flex">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          // Roving: only the selected radio is in the tab order, so the group
          // is one stop and the arrows do the rest.
          tabIndex={value === option.value ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={onKeyDown}
          className={
            "-ml-px touch-manipulation border px-[7px] py-[3px] font-mono " +
            "text-[9px] uppercase tracking-[0.06em] transition-colors " +
            "first:ml-0 disabled:cursor-not-allowed disabled:text-faint " +
            "focus-visible:outline-2 focus-visible:outline-offset-1 " +
            "focus-visible:outline-accent " +
            (value === option.value
              ? "border-accent bg-tint text-accent-text"
              : "border-rule text-meta hover:text-ink-2")
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
