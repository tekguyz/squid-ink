/** Per-turn context construction. Called fresh on every request, from that
 *  turn's OWN scope — never carried forward.
 */

import type { ChatTurn } from "@/lib/chat/types";

export interface NoteContext {
  rawTranscript: string | null;
  segments: { seq: number; time: string; speaker: string; text: string }[];
  summary: string[];
  takeaways: string[];
  actionItems: string[];
}

/** The cached block. MUST be byte-stable across turns of one conversation:
 *  prompt caching is a prefix match, so a timestamp, a turn counter or any
 *  other volatile value in here means the cache never hits and the 5-minute
 *  breakpoint buys nothing at all.
 *
 *  Segments carry their `seq` in square brackets so Claude has a stable id to
 *  cite as [[cite:tN]].
 *
 *  Generated notes are included when they exist and simply absent when they
 *  do not. There is deliberately NO branch on notegen_status — that absence
 *  is what makes "single-note chat works the instant transcription finishes"
 *  structural rather than a claim. */
export function buildTranscriptBlock(ctx: NoteContext): string {
  const parts: string[] = ["<transcript>"];

  for (const s of ctx.segments) {
    parts.push(`[${s.seq}] ${s.time} ${s.speaker}: ${s.text}`);
  }

  // Only when there are no diarized segments at all — an undiarized note
  // still has a raw transcript, and answering from it beats answering from
  // nothing.
  if (ctx.segments.length === 0 && ctx.rawTranscript) {
    parts.push(ctx.rawTranscript);
  }

  parts.push("</transcript>");

  const section = (label: string, items: string[]) => {
    if (items.length === 0) return;
    parts.push(`<${label}>`);
    for (const item of items) parts.push(`- ${item}`);
    parts.push(`</${label}>`);
  };

  section("summary", ctx.summary);
  section("takeaways", ctx.takeaways);
  section("action_items", ctx.actionItems);

  return parts.join("\n");
}

/** History → plain text messages. Tool scaffolding is DROPPED, not carried.
 *
 *  This is what lets a thread switch between this-note and all-notes without
 *  leaking the other mode's shape into the request. Citation markers are left
 *  in the text on purpose: they are prose to Claude and data to the renderer,
 *  and stripping them would make the model believe its earlier answer had no
 *  sources. */
export function flattenHistory(
  turns: ChatTurn[],
): { role: "user" | "assistant"; content: string }[] {
  return turns
    .filter((t) => t.content.trim().length > 0)
    .map((t) => ({ role: t.role, content: t.content }));
}

export const THIS_NOTE_SYSTEM = [
  "You answer questions about ONE meeting note. The full transcript and any",
  "generated notes are provided in the user message.",
  "",
  "Cite the transcript. Write [[cite:tN]] immediately after a claim, where N",
  "is the bracketed segment number from the transcript — [[cite:t8]] for the",
  "line marked [8]. Cite only numbers that appear in the transcript.",
  "",
  "If the transcript does not cover something, say so plainly. Do not answer",
  "from general knowledge and do not invent a segment number.",
  "",
  "Be concise. This is a reading surface, not a chat toy.",
].join("\n");

export const ALL_NOTES_SYSTEM = [
  "You answer questions across the user's own notes. You have one tool,",
  "search_notes. Call it whenever the question is about what was said,",
  "decided or agreed — you cannot see any note until you do.",
  "",
  "Cite results. Write [[cite:cN]] immediately after a claim, where N is the",
  "result number from the search results. Cite only numbers that were",
  "actually returned.",
  "",
  "If a search returns no results, say that nothing in the user's notes",
  "matches, and stop. Do NOT answer from general knowledge — an empty search",
  "is a real and useful answer, and filling the gap makes it a wrong one.",
  "",
  "Be concise. This is a reading surface, not a chat toy.",
].join("\n");
