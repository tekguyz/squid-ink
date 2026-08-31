import type { Note } from "@/lib/notes/view-types";

/** The demo exchange shown in the note composer.
 *
 *  A constant, not data: ask-your-notes chat is out of scope for this prompt,
 *  so nothing generates real exchanges yet. Replace this when the RAG query
 *  path ships (ROADMAP.md §4). */
export const SAMPLE_EXCHANGE: Note["sampleExchange"] = {
  question: "Did anyone commit to a date for the SOW redraft?",
  answer: [
    {
      text: "No date was said aloud. Marcus agreed to put per-clinic terms in the SOW",
      cite: { time: "04:12", segmentId: 9 },
    },
    { text: "and the Aug 31 due date is yours, added after the call." },
  ],
};
