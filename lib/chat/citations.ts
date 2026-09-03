/** Turn a finished run's tool results into the citation map persisted onto
 *  the assistant row.
 *
 *  This is what makes a `c<n>` chip still resolve after a page reload, when
 *  the tool result that produced it no longer exists anywhere.
 *
 *  Defensive by design: this runs in onFinish, AFTER the answer has already
 *  streamed to the user. Throwing here would lose a persisted message over a
 *  shape mismatch, so every branch degrades to "no citations" instead. */

import type { Citation } from "@/lib/chat/types";

interface StepShape {
  toolResults?: { output?: unknown }[];
}

interface ResultRow {
  citeKey?: unknown;
  chunkId?: unknown;
  noteId?: unknown;
  noteTitle?: unknown;
  chunkType?: unknown;
  tsStart?: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function citationsFromSteps(steps: unknown[]): Citation[] {
  const byKey = new Map<string, Citation>();

  for (const step of (steps ?? []) as StepShape[]) {
    for (const result of step?.toolResults ?? []) {
      const output = result?.output as { results?: unknown } | null | undefined;
      const rows = Array.isArray(output?.results) ? output.results : [];

      for (const raw of rows as ResultRow[]) {
        const key = str(raw?.citeKey);
        const chunkId = str(raw?.chunkId);
        const noteId = str(raw?.noteId);
        if (!key || !chunkId || !noteId) continue;

        // First write wins. Claude may search twice in one turn and each call
        // restarts its numbering at c1; the earlier result is the one its
        // earlier prose cites.
        if (byKey.has(key)) continue;

        byKey.set(key, {
          key,
          chunkId,
          noteId,
          noteTitle: str(raw?.noteTitle),
          chunkType: str(raw?.chunkType) ?? "unknown",
          tsStart: str(raw?.tsStart),
        });
      }
    }
  }

  return [...byKey.values()];
}
