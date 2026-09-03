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
 *  unrelated controls. */
export function ScopeToggle({
  value,
  disabled,
  onChange,
}: {
  value: ChatScope;
  disabled: boolean;
  onChange: (scope: ChatScope) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Search scope" className="flex">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={
            "-ml-px first:ml-0 border px-[7px] py-[3px] font-mono text-[9px] " +
            "uppercase tracking-[0.06em] transition-colors " +
            "disabled:cursor-not-allowed disabled:text-faint " +
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
