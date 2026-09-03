"use client";

import { parseAnswer } from "./parse-citations";
import { CiteRuns } from "./cite-runs";
import type { Citation } from "@/lib/chat/types";

export function ChatMessage({
  role,
  content,
  citations,
  segments,
  activeSegmentId,
  onCitationSelect,
}: {
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  segments: { id: number; time: string }[];
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
}) {
  if (role === "user") {
    return (
      <div className="flex items-baseline gap-[9px] pb-2">
        <span className="flex-none font-mono text-[9px] text-meta">YOU</span>
        <span className="text-[13px] text-ink-2">{content}</span>
      </div>
    );
  }

  const parsed = parseAnswer(content, citations, segments);

  return (
    <div className="flex items-baseline gap-[9px] pb-2">
      <span className="flex-none font-mono text-[9px] text-accent">NOTE</span>
      <span className="min-w-0 text-[13px] leading-[1.55] text-ink-2">
        <CiteRuns
          runs={parsed.runs}
          activeSegmentId={activeSegmentId}
          onCitationSelect={onCitationSelect}
        />
        {/* Every source this answer named has gone — a cited note deleted
            mid-conversation, most likely. The prose still renders, because
            withholding it would be worse, but it is not allowed to read as
            sourced. DESIGN.md § Components → Cards notice-block treatment. */}
        {parsed.ungrounded ? (
          <span className="mt-1.5 block bg-notice-bg px-[9px] py-[7px] text-[11.5px] text-notice">
            Sources unavailable — the notes this cited may have been deleted.
          </span>
        ) : null}
      </span>
    </div>
  );
}
