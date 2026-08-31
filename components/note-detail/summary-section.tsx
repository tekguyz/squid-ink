"use client";

import type { CiteRun } from "@/lib/notes/view-types";
import { CitationChip } from "./citation-chip";
import { SectionRule } from "./section-rule";

export interface SummarySectionProps {
  runs: CiteRun[];
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
}

export function SummarySection({
  runs,
  activeSegmentId,
  onCitationSelect,
}: SummarySectionProps) {
  return (
    <section>
      <SectionRule label="Summary" />
      <p className="pb-5 text-[14.5px] leading-[1.66] text-pretty text-ink-prose">
        {runs.map((run, i) => (
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
      </p>
    </section>
  );
}
