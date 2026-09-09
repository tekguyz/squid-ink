import type { ProcessingStatus } from "@/lib/notes/view-types";
import type { NoteTag } from "@/lib/notes/tags";

/**
 * Bucket the dashboard feed into day groups.
 *
 * Pure: no I/O, no clock, no randomness. `now` is a parameter rather than a
 * `new Date()` so a bucket boundary is testable and so nothing in a render
 * path reads the clock — the same rule the waveform constants exist for.
 *
 * Every date part is read in UTC, exactly as lib/notes/note-view-model.ts
 * formats its meta line. `toLocaleDateString` would render differently on the
 * server and in the browser and React would report a hydration mismatch. The
 * cost is that "Today" means the UTC day, which is the trade the rest of this
 * app already made.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The same string lib/notes/note-view-model.ts, lib/rag/search-tool.ts and
 *  components/note-detail/chat/parse-citations.ts render for a null title.
 *  `notes.title` is nullable with no default and "Untitled note" is a
 *  render-time fallback, never a stored value — see CLAUDE.md § Note
 *  generation. */
export const UNTITLED_NOTE = "Untitled note";

/** A note as the feed query hands it over: row-shaped, uncounted, unformatted. */
export interface FeedNoteInput {
  id: string;
  title: string | null;
  createdAt: string;
  processingStatus: ProcessingStatus;
  durationSeconds: number | null;
  /** First line of the generated summary, or null before one exists. */
  preview: string | null;
  /** The tags on this note, already sorted. Empty for an untagged note — a
   *  note with no tags and a note whose tags are still loading are not
   *  different states here, because this function has no loading state. */
  tags: NoteTag[];
}

/** Per-note chunk tallies, keyed by note id. A note with no generated chunks
 *  has no entry at all — which is why the merge below defaults rather than
 *  propagating undefined. */
export interface NoteCounts {
  actions: number;
  spans: number;
}

/** One row of the feed, formatted and counted. */
export interface FeedNote {
  id: string;
  title: string;
  /** "10:00", UTC. */
  time: string;
  /** "41 min", or null when the note carries no audio duration. */
  duration: string | null;
  preview: string | null;
  processingStatus: ProcessingStatus;
  actionCount: number;
  spanCount: number;
  tags: NoteTag[];
}

export interface DayGroup {
  /** "2026-08-26". Stable across renders, so it is the React key. */
  key: string;
  /** "Today · Wed 26 Aug", "Yesterday · Tue 25 Aug", "Wed 20 Aug",
   *  "Wed 12 Aug 2026". */
  label: string;
  notes: FeedNote[];
}

/** How many days out the weekday alone still locates a note. Past this the
 *  label carries the year, because "Wed 12 Aug" a year later is a lie. */
const DATED_AFTER_DAYS = 7;

const dayKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

const shortDate = (d: Date) => `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

/** Whole UTC days between two instants, ignoring the time of day. */
function daysApart(then: Date, now: Date): number {
  const a = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

function dayLabel(created: Date, now: Date): string {
  const age = daysApart(created, now);
  if (age === 0) return `Today · ${shortDate(created)}`;
  if (age === 1) return `Yesterday · ${shortDate(created)}`;
  if (age < DATED_AFTER_DAYS) return shortDate(created);
  return `${shortDate(created)} ${created.getUTCFullYear()}`;
}

const clock = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

function duration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

/**
 * Group notes under day headings, newest day first, preserving the order the
 * query returned within each day.
 *
 * A note missing from `counts` reads as zero, never as null: the feed renders
 * "0 ACTIONS" for a note that has not generated yet, and an absent tally is
 * the same fact as a tally of nothing.
 */
export function groupNotesByDay(
  notes: readonly FeedNoteInput[],
  counts: ReadonlyMap<string, NoteCounts>,
  now: Date,
): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();

  for (const note of notes) {
    const created = new Date(note.createdAt);
    const key = dayKey(created);

    let group = byKey.get(key);
    if (!group) {
      group = { key, label: dayLabel(created, now), notes: [] };
      byKey.set(key, group);
      groups.push(group);
    }

    const tally = counts.get(note.id);
    group.notes.push({
      id: note.id,
      title: note.title ?? UNTITLED_NOTE,
      time: clock(created),
      duration: duration(note.durationSeconds),
      preview: note.preview,
      processingStatus: note.processingStatus,
      actionCount: tally?.actions ?? 0,
      spanCount: tally?.spans ?? 0,
      tags: note.tags,
    });
  }

  return groups;
}
