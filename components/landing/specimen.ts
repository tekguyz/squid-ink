import type { Segment } from "@/lib/notes/view-types";

/**
 * The excerpt the landing page shows: real pipeline output, not a drawing.
 *
 * Every string below is copied verbatim from `lib/demo/demo-note-2.json`, one
 * of the three demo notes, and `__tests__/specimen.test.ts` fails if any of
 * them stops matching it. A copy rather than an import: the fixture is 426 KB
 * of embeddings, and the page needs about 2 KB of it.
 *
 * ONE THING IS CHOSEN BY HAND: which segment each chip cites. The fixture's
 * chunks carry no citation metadata, so the pairing here was made by reading
 * the transcript, and the page's caption says so. One segment per claim, as
 * the pipeline writes them. Each chip points at the line that says what its
 * claim says; the test checks the times and speakers, and a reader can check
 * the rest.
 */

export const SPECIMEN_TITLE = "Planning Haas group recording sessions and data storage";

/** 188 seconds in the fixture. */
export const SPECIMEN_DURATION = "3:08";

export const SPECIMEN_SUMMARY =
  "The team reviewed responses from the Haas recruitment outreach, where nine of eleven respondents agreed to participate and two requested compensation beyond lunch. They decided to proceed with two sessions of four participants, declining additional compensation requests and holding the ninth person for a future round.";

export interface SpecimenClaim {
  n: string;
  text: string;
  /** Segment ids (the fixture's `seq`) this claim cites. One, as the pipeline
   *  writes them; an array only so a claim could carry none. */
  cites: number[];
}

export const SPECIMEN_TAKEAWAYS: SpecimenClaim[] = [
  {
    n: "02",
    text: "The team decided against providing additional compensation beyond lunch due to lack of budget.",
    cites: [8],
  },
  {
    n: "03",
    text: "Participants will be split into two sessions of four, leaving the ninth respondent for a future round to maintain diarization quality.",
    cites: [16],
  },
  {
    n: "04",
    text: "Current disk space allows for five meetings after recent archiving, requiring an additional batch to be archived to cover eight planned meetings.",
    cites: [23],
  },
];

export const SPECIMEN_ACTIONS: SpecimenClaim[] = [
  {
    n: "03",
    text: "Start the next disk archiving batch on Monday to complete the copy and clone processes by the fifteenth.",
    cites: [27],
  },
  {
    n: "04",
    text: "Draft the confirmation email explaining the CD-ROM screening timeline in plain language and circulate it internally before sending.",
    cites: [34],
  },
];

const S1 = { name: "Speaker 1", initials: "S1", token: "speaker-1" } as const;
const S2 = { name: "Speaker 2", initials: "S2", token: "speaker-2" } as const;
const S3 = { name: "Speaker 3", initials: "S3", token: "speaker-3" } as const;

/** Only the cited lines, in order. The gaps between them are real gaps in the
 *  recording, and the page marks them. */
export const SPECIMEN_SEGMENTS: Segment[] = [
  { id: 8, time: "00:42", speaker: S3, text: "We can't pay them. There's no line for it." },
  {
    id: 16,
    time: "01:24",
    speaker: S2,
    text: "Do two of four and drop the last one. Eight good recordings beats nine mediocre ones.",
  },
  {
    id: 23,
    time: "01:54",
    speaker: S3,
    text: "The archiving finished. We've got about ten gigabytes back, which is five meetings.",
  },
  {
    id: 27,
    time: "02:13",
    speaker: S3,
    text: "The copy takes eleven hours and the clone takes another eleven. So yes, if I start Monday.",
  },
  {
    id: 34,
    time: "02:46",
    speaker: S1,
    text: "Will do. I'll draft it and send it round before it goes out.",
  },
];

export const segmentTime = (id: number) =>
  SPECIMEN_SEGMENTS.find((s) => s.id === id)?.time ?? "";

/** The anchor a chip links to. A fragment link, so the chip works with no
 *  client JavaScript; the line highlights through `:target`. */
export const segmentAnchor = (id: number) => `t${id}`;
