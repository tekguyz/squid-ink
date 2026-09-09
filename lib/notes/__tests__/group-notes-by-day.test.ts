import { describe, expect, it } from "vitest";
import {
  groupNotesByDay,
  UNTITLED_NOTE,
  type FeedNoteInput,
  type NoteCounts,
} from "../group-notes-by-day";

const NOW = new Date("2026-08-26T12:00:00Z");

function note(overrides: Partial<FeedNoteInput> & { id: string }): FeedNoteInput {
  return {
    title: "A note",
    createdAt: "2026-08-26T10:00:00Z",
    processingStatus: "completed",
    durationSeconds: 2460,
    preview: null,
    tags: [],
    ...overrides,
  };
}

const counts = (entries: Record<string, NoteCounts>) => new Map(Object.entries(entries));

describe("groupNotesByDay", () => {
  it("puts two notes recorded on the same UTC day in one bucket", () => {
    const groups = groupNotesByDay(
      [
        note({ id: "a", createdAt: "2026-08-26T10:00:00Z" }),
        note({ id: "b", createdAt: "2026-08-26T09:15:00Z" }),
      ],
      new Map(),
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("2026-08-26");
    expect(groups[0].label).toBe("Today · Wed 26 Aug");
    expect(groups[0].notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("keeps separate days apart, in the order the query returned them", () => {
    const groups = groupNotesByDay(
      [
        note({ id: "a", createdAt: "2026-08-26T10:00:00Z" }),
        note({ id: "b", createdAt: "2026-08-25T15:30:00Z" }),
        note({ id: "c", createdAt: "2026-08-24T09:00:00Z" }),
      ],
      new Map(),
      NOW,
    );

    expect(groups.map((g) => g.label)).toEqual([
      "Today · Wed 26 Aug",
      "Yesterday · Tue 25 Aug",
      "Mon 24 Aug",
    ]);
  });

  it("gives a note older than a week a dated bucket carrying the year", () => {
    // The weekday alone stops locating anything past a week: "Wed 12 Aug" a
    // year later reads as this year.
    const groups = groupNotesByDay(
      [note({ id: "old", createdAt: "2026-08-12T09:00:00Z" })],
      new Map(),
      NOW,
    );

    expect(groups[0].label).toBe("Wed 12 Aug 2026");
  });

  it("dates the bucket from the eighth day on, not the seventh", () => {
    const seventh = groupNotesByDay(
      [note({ id: "x", createdAt: "2026-08-20T09:00:00Z" })],
      new Map(),
      NOW,
    );
    const eighth = groupNotesByDay(
      [note({ id: "x", createdAt: "2026-08-19T09:00:00Z" })],
      new Map(),
      NOW,
    );

    expect(seventh[0].label).toBe("Thu 20 Aug");
    expect(eighth[0].label).toBe("Wed 19 Aug 2026");
  });

  it("returns an empty array for an empty list", () => {
    // The shape a brand-new account produces, and the shape a second user sees
    // once RLS has filtered everything out.
    expect(groupNotesByDay([], new Map(), NOW)).toEqual([]);
  });

  it("reads a note with no counted chunks as 0, never as null", () => {
    // A note that has not generated yet is absent from the tally map entirely.
    // Zero and "no entry" are the same fact, and the row renders a number
    // either way.
    const groups = groupNotesByDay([note({ id: "fresh" })], new Map(), NOW);

    expect(groups[0].notes[0].actionCount).toBe(0);
    expect(groups[0].notes[0].spanCount).toBe(0);
  });

  it("carries the counts it is given", () => {
    const groups = groupNotesByDay(
      [note({ id: "a" }), note({ id: "b" })],
      counts({ a: { actions: 3, spans: 12 } }),
      NOW,
    );

    expect(groups[0].notes[0]).toMatchObject({ actionCount: 3, spanCount: 12 });
    expect(groups[0].notes[1]).toMatchObject({ actionCount: 0, spanCount: 0 });
  });

  it("falls back to the same untitled string the rest of the app renders", () => {
    const groups = groupNotesByDay([note({ id: "a", title: null })], new Map(), NOW);

    expect(groups[0].notes[0].title).toBe(UNTITLED_NOTE);
    expect(UNTITLED_NOTE).toBe("Untitled note");
  });

  it("formats the clock and the duration, and drops a duration it does not have", () => {
    const groups = groupNotesByDay(
      [
        note({ id: "a", createdAt: "2026-08-26T09:05:00Z", durationSeconds: 2460 }),
        note({ id: "b", createdAt: "2026-08-26T00:00:00Z", durationSeconds: null }),
        note({ id: "c", createdAt: "2026-08-26T08:00:00Z", durationSeconds: 20 }),
      ],
      new Map(),
      NOW,
    );

    expect(groups[0].notes.map((n) => [n.time, n.duration])).toEqual([
      ["09:05", "41 min"],
      ["00:00", null],
      // Rounds up rather than to "0 min": a 20-second recording is not nothing.
      ["08:00", "1 min"],
    ]);
  });

  it("buckets by the UTC day, so a late-evening note does not drift", () => {
    // note-view-model.ts formats from UTC parts for the same reason: a
    // locale-dependent date differs between the server and the browser and
    // React reports a hydration mismatch.
    const groups = groupNotesByDay(
      [note({ id: "a", createdAt: "2026-08-25T23:59:00Z" })],
      new Map(),
      NOW,
    );

    expect(groups[0].key).toBe("2026-08-25");
    expect(groups[0].label).toBe("Yesterday · Tue 25 Aug");
  });
});
