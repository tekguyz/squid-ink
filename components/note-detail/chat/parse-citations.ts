/** Marker text in, renderable runs out.
 *
 *  The marker's key says WHERE the cited content lives, which is what decides
 *  what the chip can do:
 *    t<seq>  a transcript segment on the page being viewed -> scroll to it
 *    c<n>    result n from a tool call, usually another note -> navigate
 *
 *  Keying on chunk_type instead would have no answer for a transcript_segment
 *  chunk returned by the search tool in all-notes mode: "jump to its
 *  timestamp" would land on the wrong recording's timeline. Location decides
 *  what the chip can DO; chunk type only decides what it SAYS.
 */

import type { Citation } from "@/lib/chat/types";

export interface ChatCiteRun {
  text: string;
  cite?:
    | { kind: "segment"; segmentId: number; time: string }
    | { kind: "note"; noteId: string; noteTitle: string; label: string };
}

export interface ParsedAnswer {
  runs: ChatCiteRun[];
  markerCount: number;
  resolvedCount: number;
  /** True only when the message HAD markers and NONE of them resolved. */
  ungrounded: boolean;
}

/** Complete markers only. A half-arrived "[[cite:c" mid-stream does not match
 *  and stays as plain text, so the tail of a streaming answer does not
 *  flicker.
 *
 *  Built fresh per call rather than held at module scope: a /g regex carries
 *  lastIndex, and parseAnswer runs on every streamed token. A shared one
 *  would make two identical calls return different answers. */
const marker = () => /\[\[cite:([tc])(\d+)\]\]/g;

const TYPE_LABEL: Record<string, string> = {
  summary: "Summary",
  takeaway: "Takeaway",
  action_item: "Action item",
  transcript_segment: "Transcript",
  imported_doc: "Document",
};

function labelFor(citation: Citation, title: string): string {
  if (citation.tsStart) return `${title} ${citation.tsStart}`;
  return `${title} · ${TYPE_LABEL[citation.chunkType] ?? "Note"}`;
}

export function parseAnswer(
  text: string,
  citations: Citation[],
  segments: { id: number; time: string }[],
): ParsedAnswer {
  const byKey = new Map(citations.map((c) => [c.key, c]));
  const byId = new Map(segments.map((s) => [s.id, s]));

  const runs: ChatCiteRun[] = [];
  let markerCount = 0;
  let resolvedCount = 0;
  let cursor = 0;

  const pattern = marker();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    markerCount += 1;
    const [whole, kind, digits] = match;
    const before = text.slice(cursor, match.index);
    cursor = match.index + whole.length;

    let cite: ChatCiteRun["cite"];

    if (kind === "t") {
      const segment = byId.get(Number(digits));
      if (segment) {
        cite = { kind: "segment", segmentId: segment.id, time: segment.time };
      }
    } else {
      const citation = byKey.get(`c${digits}`);
      if (citation) {
        const title = citation.noteTitle ?? "Untitled note";
        cite = {
          kind: "note",
          noteId: citation.noteId,
          noteTitle: title,
          label: labelFor(citation, title),
        };
      }
    }

    if (cite) {
      resolvedCount += 1;
      runs.push({ text: before, cite });
    } else {
      // Silent is right for a malformed marker; it is WRONG when the cause is
      // a deleted chunk or a removed note. Warn so the failure stays visible
      // to whoever is debugging, and let `ungrounded` carry the user-facing
      // half.
      console.warn(`[chat] dropped an unresolvable citation marker: ${whole}`);
      runs.push({ text: before });
    }
  }

  const tail = text.slice(cursor);
  if (tail.length > 0) runs.push({ text: tail });

  return {
    runs,
    markerCount,
    resolvedCount,
    ungrounded: markerCount > 0 && resolvedCount === 0,
  };
}
