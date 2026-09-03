"use client";

import Link from "next/link";
import { CitationChip } from "../citation-chip";
import type { ChatCiteRun } from "./parse-citations";

/** Renders parsed runs. Two chip shapes, because the two citations can do
 *  genuinely different things — see parse-citations.ts for why the split is
 *  on location rather than on chunk type. */
export function CiteRuns({
  runs,
  activeSegmentId,
  onCitationSelect,
}: {
  runs: ChatCiteRun[];
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
}) {
  return (
    <>
      {runs.map((run, i) => (
        // Keyed on position AND on what the run resolves to. A bare index makes
        // React reuse a chip DOM node across different citations while the
        // answer streams, because the run list is re-derived on every token.
        <span key={`${i}:${run.cite?.kind ?? "text"}:${
          run.cite?.kind === "segment" ? run.cite.segmentId : run.cite?.noteId ?? ""
        }`}>
          {run.text}
          {run.cite?.kind === "segment" ? (
            <CitationChip
              time={run.cite.time}
              segmentId={run.cite.segmentId}
              active={activeSegmentId === run.cite.segmentId}
              onSelect={onCitationSelect}
            />
          ) : null}
          {run.cite?.kind === "note" ? (
            // A cross-note citation cannot scroll to anything on this page —
            // it lives in another recording. Navigating is the only thing
            // that lets the reader actually follow it, which is why this is
            // an anchor and not a button.
            <Link
              href={`/notes/${run.cite.noteId}`}
              aria-label={`Open ${run.cite.label}`}
              className={
                "mx-0.5 inline-block bg-tint px-[5px] py-px align-[1px] " +
                "font-mono text-[10px] text-accent-text transition-colors " +
                "hover:bg-tint-hover focus-visible:outline-2 " +
                "focus-visible:outline-offset-1 focus-visible:outline-accent"
              }
            >
              {run.cite.label}
            </Link>
          ) : null}
        </span>
      ))}
    </>
  );
}
