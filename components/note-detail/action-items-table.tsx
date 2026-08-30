"use client";

import type { ActionItem } from "@/lib/mock/types";
import { CitationChip } from "./citation-chip";
import { SectionRule } from "./section-rule";

export interface ActionItemsTableProps {
  items: ActionItem[];
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
}

export function ActionItemsTable({
  items,
  activeSegmentId,
  onCitationSelect,
}: ActionItemsTableProps) {
  return (
    <section>
      <SectionRule label="Action items" />
      <ul className="flex flex-col gap-[5px] pb-5">
        {items.map((item) => (
          <li
            key={item.text}
            className="grid grid-cols-[18px_1fr_92px_70px_50px] items-center gap-[11px] border-b border-rule-3 py-1.5 text-[13.5px]"
          >
            <input
              type="checkbox"
              aria-label={item.text}
              className="size-[11px] appearance-none border border-faint accent-accent checked:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            />
            <span>{item.text}</span>
            <span className="font-mono text-[10px] text-meta-3">{item.owner}</span>
            <span className="font-mono text-[10px] text-meta-3">{item.due}</span>
            <CitationChip
              time={item.time}
              segmentId={item.segmentId}
              active={activeSegmentId === item.segmentId}
              variant="bare"
              onSelect={onCitationSelect}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
