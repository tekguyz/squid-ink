/** View types the Note Detail components consume. Shaped by
 *  lib/notes/note-view-model.ts from database rows. No colours live here —
 *  speakers carry a token name, and the token resolves in `app/globals.css`. */

export type SpeakerToken = "speaker-1" | "speaker-2" | "speaker-3";

export interface Speaker {
  name: string;
  initials: string;
  token: SpeakerToken;
}

export interface Segment {
  id: number;
  time: string;
  speaker: Speaker;
  text: string;
}

export interface Takeaway {
  n: string;
  segmentId: number;
  time: string;
  text: string;
}

export interface SpeakerStat {
  speaker: Speaker;
  talk: string;
  asked: string;
  fillers: string;
}

export interface Persona {
  id: string;
  name: string;
  sub: string;
  takeaways: Takeaway[];
  actions: string[];
}

export interface ActionItem {
  text: string;
  owner: string;
  due: string;
  time: string;
  segmentId: number;
}

/** A stretch of prose, optionally closed by a citation chip. Modelled as runs
 *  so chips can sit inline without dangerouslySetInnerHTML. */
export interface CiteRun {
  text: string;
  cite?: { time: string; segmentId: number };
}

export interface Note {
  id: string;
  title: string;
  meta: string;
  turnCount: number;
  duration: string;
  playhead: string;
  spansLinked: number;
  summary: CiteRun[];
  actionItems: ActionItem[];
  stats: SpeakerStat[];
  segments: Segment[];
  personas: Persona[];
  waveform: number[];
  sampleExchange: { question: string; answer: CiteRun[] };
}
