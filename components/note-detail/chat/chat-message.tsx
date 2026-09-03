"use client";

import { useMemo } from "react";
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
  settled = true,
}: {
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  segments: { id: number; time: string }[];
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
  /** False while this turn is still streaming. A half-arrived answer has
   *  markers that simply have not finished arriving, so it must neither
   *  warn about them nor be judged ungrounded. */
  settled?: boolean;
}) {
  // Memoised on the three inputs that can change it, NOT on activeSegmentId —
  // which changes on every citation click and does not affect parsing.
  //
  // Without this, every persisted turn re-parses on every streamed token: the
  // panel re-renders per token, and a twenty-turn history means twenty regex
  // passes for each one. The parse is cheap; doing it a few thousand times a
  // second is not.
  const parsed = useMemo(
    () =>
      role === "assistant"
        ? parseAnswer(content, citations, segments, { warn: settled })
        : null,
    [role, content, citations, segments, settled],
  );

  if (role === "user" || !parsed) {
    return (
      <div className="flex items-baseline gap-[9px] pb-2">
        <span className="flex-none font-mono text-[9px] text-meta">YOU</span>
        <span className="min-w-0 text-[13px] break-words text-ink-2">
          {content}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-[9px] pb-2">
      <span className="flex-none font-mono text-[9px] text-accent">NOTE</span>
      <span className="min-w-0 text-[13px] leading-[1.55] break-words text-ink-2">
        <CiteRuns
          runs={parsed.runs}
          activeSegmentId={activeSegmentId}
          onCitationSelect={onCitationSelect}
        />
        {/* Every source this answer named has gone — a cited note deleted
            mid-conversation, most likely. The prose still renders, because
            withholding it would be worse, but it is not allowed to read as
            sourced. DESIGN.md § Components → Cards notice-block treatment. */}
        {settled && parsed.ungrounded ? (
          <span className="mt-1.5 block bg-notice-bg px-[9px] py-[7px] text-[11.5px] text-notice">
            Sources unavailable — the notes this cited may have been deleted.
          </span>
        ) : null}
      </span>
    </div>
  );
}
