"use client";

import type { Takeaway } from "@/lib/mock/types";
import { CitationChip } from "./citation-chip";
import { SectionRule } from "./section-rule";

export interface TakeawaysSectionProps {
  takeaways: Takeaway[];
  personaLabel: string;
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
}

export function TakeawaysSection({
  takeaways,
  personaLabel,
  activeSegmentId,
  onCitationSelect,
}: TakeawaysSectionProps) {
  return (
    <section>
      <SectionRule label={`Takeaways · ${personaLabel}`} />
      <ol className="flex flex-col gap-[9px] pb-5">
        {takeaways.map((takeaway) => (
          <li key={takeaway.n} className="flex items-baseline gap-3">
            <span className="w-4 flex-none font-header text-[15px] font-semibold text-accent">
              {takeaway.n}
            </span>
            <span className="text-sm leading-[1.55] text-pretty">
              {takeaway.text}
              <span className="ml-1.5 inline-block">
                <CitationChip
                  time={takeaway.time}
                  segmentId={takeaway.segmentId}
                  active={activeSegmentId === takeaway.segmentId}
                  onSelect={onCitationSelect}
                />
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
