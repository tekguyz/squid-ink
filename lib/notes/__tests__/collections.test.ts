import { describe, expect, it } from "vitest";
import {
  indexCollections,
  normalizeCollectionName,
  type CollectionRow,
  type NoteCollectionRow,
} from "../collections";

const collection = (id: string, slug: string, name = slug): CollectionRow => ({
  id,
  slug,
  name,
});

const link = (note_id: string, collection_id: string): NoteCollectionRow => ({
  note_id,
  collection_id,
});

describe("normalizeCollectionName", () => {
  it("keeps what the user typed and derives the key from it", () => {
    // The name is what the rail prints; the slug is the URL segment and the
    // unique constraint. They are different jobs done by one input.
    expect(normalizeCollectionName("Q3 Planning")).toEqual({
      slug: "q3-planning",
      name: "Q3 Planning",
    });
  });

  it("collapses whitespace so two spellings are one collection", () => {
    expect(normalizeCollectionName("  Q3   Planning ")?.slug).toBe(
      "q3-planning",
    );
  });

  it("does not strip a leading #, unlike a tag", () => {
    // "#" is a tag's cue, not a collection's. A collection called "#1
    // Priority" keeps the character it was named with.
    expect(normalizeCollectionName("#1 Priority")?.name).toBe("#1 Priority");
  });

  it("returns null for anything that normalises to nothing", () => {
    // An unnamed collection is not a collection, and this is the one place
    // that decides so.
    expect(normalizeCollectionName("   ")).toBeNull();
    expect(normalizeCollectionName("///")).toBeNull();
  });

  it("trims a name too long for a rail row", () => {
    expect(normalizeCollectionName("x".repeat(80))?.name).toHaveLength(48);
  });
});

describe("indexCollections — many-to-many", () => {
  const rows = [
    collection("c1", "q3-planning", "Q3 Planning"),
    collection("c2", "hiring", "Hiring"),
  ];

  it("puts one note in two collections at once", () => {
    const { byNote } = indexCollections(rows, [
      link("n1", "c1"),
      link("n1", "c2"),
    ]);

    expect(byNote.get("n1")?.map((c) => c.id)).toEqual([
      // Sorted by name: Hiring before Q3 Planning. A list that reorders
      // between renders cannot be aimed at.
      "hiring",
      "q3-planning",
    ]);
  });

  it("dropping one membership leaves the other standing", () => {
    // The same two collections, minus one join row — which is exactly what
    // removeNoteFromCollection deletes.
    const { byNote, chips } = indexCollections(rows, [link("n1", "c1")]);

    expect(byNote.get("n1")?.map((c) => c.id)).toEqual(["q3-planning"]);
    // The emptied collection is still a collection, with a count of zero.
    expect(chips.find((c) => c.id === "hiring")).toEqual({
      id: "hiring",
      name: "Hiring",
      count: 0,
    });
  });

  it("counts every note in a collection, not one per note", () => {
    const { chips } = indexCollections(rows, [
      link("n1", "c1"),
      link("n2", "c1"),
      link("n3", "c1"),
    ]);

    expect(chips.find((c) => c.id === "q3-planning")?.count).toBe(3);
  });

  it("lists a collection with no notes in it", () => {
    // An empty collection is a real thing a user just made and is about to
    // file into. Hiding it would hide the thing they are aiming at.
    const { chips } = indexCollections(rows, []);
    expect(chips.map((c) => c.id)).toEqual(["hiring", "q3-planning"]);
  });

  it("ignores a membership whose collection is not visible", () => {
    // RLS filters the two reads independently. The honest answer to "a
    // collection you cannot see" is to render nothing, not a blank row.
    const { byNote } = indexCollections(rows, [link("n1", "c-someone-else")]);
    expect(byNote.get("n1")).toBeUndefined();
  });
});
