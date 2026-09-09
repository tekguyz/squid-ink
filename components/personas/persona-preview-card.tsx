"use client";

import Link from "next/link";
import type { PersonaPreview } from "@/lib/notes/get-personas-screen";

/**
 * "Preview on last note" — a REAL takeaway from the user's most recent note,
 * or a one-line empty state saying why there is none.
 *
 * Never an example. The drawing's pricing sentence is fixture text, and a
 * screen whose job is to explain what a lens produces cannot demonstrate it
 * with something the lens did not produce. Three honest states, in order:
 * no notes at all, a note this lens has not run on, and a real takeaway.
 */
export function PersonaPreviewCard({
  preview,
  personaName,
  lastNoteId,
  lastNoteTitle,
}: {
  preview: PersonaPreview | undefined;
  personaName: string;
  lastNoteId: string | null;
  lastNoteTitle: string | null;
}) {
  return (
    <div className="bg-dock border-accent mt-[12px] border-l-2 px-[13px] py-[12px]">
      <p className="font-mono text-meta text-[8.5px] tracking-[0.14em] uppercase">
        Preview on last note
      </p>

      {lastNoteId === null ? (
        <p className="font-body text-muted mt-[7px] text-[13.5px] leading-[1.6]">
          No notes yet — record one and this shows what {personaName} wrote.
        </p>
      ) : preview === undefined ? (
        <p className="font-body text-muted mt-[7px] text-[13.5px] leading-[1.6]">
          {personaName} has not run on{" "}
          <Link
            href={`/notes/${lastNoteId}`}
            className="text-ink-2 focus-visible:outline-accent underline focus-visible:outline-2 focus-visible:outline-offset-1"
          >
            {lastNoteTitle}
          </Link>
          .
        </p>
      ) : (
        <p className="font-body text-ink-prose mt-[7px] text-[13.5px] leading-[1.6] text-pretty">
          {preview.text}
          <span className="font-mono bg-tint text-accent-text ml-[5px] inline-block px-[5px] py-px text-[10px]">
            {preview.time}
          </span>
        </p>
      )}
    </div>
  );
}
