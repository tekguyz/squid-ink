"use client";

import { useId } from "react";
import type { ActionItem } from "@/lib/mock/types";
import { CitationChip } from "./citation-chip";
import { SectionRule } from "./section-rule";

export interface ActionItemsTableProps {
  items: ActionItem[];
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
}

function Row({
  item,
  activeSegmentId,
  onCitationSelect,
}: {
  item: ActionItem;
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
}) {
  const id = useId();
  return (
    <li className="grid grid-cols-[18px_1fr_92px_70px_50px] items-center gap-[11px] border-b border-rule-3 py-1.5 text-[13.5px]">
      <input
        id={id}
        type="checkbox"
        className="size-[11px] cursor-pointer appearance-none border border-faint checked:border-accent checked:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      />
      {/* Label wraps the text so the whole row title is a hit target. */}
      <label htmlFor={id} className="cursor-pointer">
        {item.text}
      </label>
      <span className="font-mono text-[10px] tabular-nums text-meta-3">{item.owner}</span>
      <span className="font-mono text-[10px] tabular-nums text-meta-3">{item.due}</span>
      <CitationChip
        time={item.time}
        segmentId={item.segmentId}
        active={activeSegmentId === item.segmentId}
        variant="bare"
        onSelect={onCitationSelect}
      />
    </li>
  );
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
          <Row
            key={item.text}
            item={item}
            activeSegmentId={activeSegmentId}
            onCitationSelect={onCitationSelect}
          />
        ))}
      </ul>
    </section>
  );
}
