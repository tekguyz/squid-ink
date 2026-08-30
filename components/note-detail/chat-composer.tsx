"use client";

import { useState } from "react";
import type { CiteRun } from "@/lib/mock/types";
import { CitationChip } from "./citation-chip";

export interface ChatComposerProps {
  personaLabel: string;
  question: string;
  answer: CiteRun[];
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
}

export function ChatComposer({
  personaLabel,
  question,
  answer,
  activeSegmentId,
  onCitationSelect,
}: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const canSubmit = draft.trim().length > 0;

  // Mock only — nothing is sent anywhere. Submitting just clears the draft.
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setDraft("");
  };

  return (
    <div className="border-t border-rule bg-dock px-[26px] pt-3 pb-3.5">
      <div className="flex items-baseline gap-[9px] pb-2">
        <span className="flex-none font-mono text-[9px] text-meta">YOU</span>
        <span className="text-[13px] text-ink-2">{question}</span>
      </div>

      <div className="flex items-baseline gap-[9px]">
        <span className="flex-none font-mono text-[9px] text-accent">NOTE</span>
        <span className="text-[13px] leading-[1.55] text-ink-2">
          {answer.map((run, i) => (
            <span key={i}>
              {run.text}
              {run.cite ? (
                <CitationChip
                  time={run.cite.time}
                  segmentId={run.cite.segmentId}
                  active={activeSegmentId === run.cite.segmentId}
                  onSelect={onCitationSelect}
                />
              ) : null}
            </span>
          ))}
        </span>
      </div>

      <form
        onSubmit={submit}
        className="mt-[11px] flex items-center gap-[9px] border border-rule bg-paper px-2.5 py-2 focus-within:border-accent"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Ask this note"
          placeholder="Ask this note…"
          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-placeholder"
        />
        <span className="font-mono text-[9px] tracking-[0.06em] uppercase text-accent">
          {personaLabel}
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="font-mono text-[9px] tracking-[0.06em] uppercase text-accent-pressed disabled:cursor-not-allowed disabled:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
