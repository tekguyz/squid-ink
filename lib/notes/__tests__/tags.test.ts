import { describe, expect, it } from "vitest";
import {
  indexTags,
  normalizeTagName,
  TAG_TOKENS,
  tokenForSlug,
  type NoteTagRow,
  type TagRow,
} from "../tags";

const tag = (over: Partial<TagRow> & { id: string; slug: string }): TagRow => ({
  name: over.slug,
  color_token: "tag-1",
  ...over,
});

describe("normalizeTagName", () => {
  it("strips the leading # so the design's cue can be typed literally", () => {
    // App Surfaces 07 says "TYPE # IN A NOTE". The field prints its own #, so
    // a user typing a second one must not end up with a tag called "#legal".
    expect(normalizeTagName("#legal")).toEqual({ slug: "legal", name: "legal" });
    expect(normalizeTagName("##legal")?.slug).toBe("legal");
  });

  it("keeps what the user typed as the name and derives the key", () => {
    expect(normalizeTagName("  Follow   Up  ")).toEqual({
      slug: "follow-up",
      name: "Follow Up",
    });
  });

  it("is the same key whatever the case", () => {
    expect(normalizeTagName("Pricing")?.slug).toBe(
      normalizeTagName("pricing")?.slug,
    );
  });

  it("rejects anything that normalises to nothing", () => {
    // An empty tag is not a tag, and this is the one place that decides so.
    for (const raw of ["", "   ", "#", "###", "—", "!!!"]) {
      expect(normalizeTagName(raw)).toBeNull();
    }
  });

  it("trims a tag to a label rather than letting it become a sentence", () => {
    const long = "a".repeat(80);
    expect(normalizeTagName(long)?.name.length).toBe(32);
  });
});

describe("tokenForSlug", () => {
  it("gives the same slug the same hue every time", () => {
    // The badge colour must not move between the feed and Note Detail, or
    // between two renders of the same screen.
    expect(tokenForSlug("pricing")).toBe(tokenForSlug("pricing"));
  });

  it("only ever returns a token from the fixed palette", () => {
    // Five hues, no colour picker — per-tag customisation is deliberately not
    // part of this feature, so there is no sixth value to render.
    for (const slug of ["pricing", "blocker", "legal", "hiring", "follow-up", "x", ""]) {
      expect(TAG_TOKENS).toContain(tokenForSlug(slug));
    }
  });
});

describe("indexTags", () => {
  const tags = [
    tag({ id: "t1", slug: "pricing", name: "pricing", color_token: "tag-1" }),
    tag({ id: "t2", slug: "legal", name: "legal", color_token: "tag-3" }),
  ];

  it("exposes the slug as the id — never the uuid", () => {
    // A uuid is per-user and does not survive a reseed. Same rule the persona
    // view model follows.
    const { byNote } = indexTags(tags, [{ note_id: "n1", tag_id: "t1" }]);
    expect(byNote.get("n1")).toEqual([
      { id: "pricing", name: "pricing", token: "tag-1" },
    ]);
  });

  it("counts each tag once per note that carries it", () => {
    const links: NoteTagRow[] = [
      { note_id: "n1", tag_id: "t1" },
      { note_id: "n2", tag_id: "t1" },
      { note_id: "n2", tag_id: "t2" },
    ];
    const { chips } = indexTags(tags, links);
    expect(chips.map((c) => [c.id, c.count])).toEqual([
      ["legal", 1],
      ["pricing", 2],
    ]);
  });

  it("lists a tag with no notes at a count of zero rather than hiding it", () => {
    const { chips } = indexTags(tags, []);
    expect(chips.every((c) => c.count === 0)).toBe(true);
    expect(chips).toHaveLength(2);
  });

  it("drops a link whose tag this user cannot see", () => {
    // TENANT SCOPING, at the shaping layer. RLS filters the two reads
    // independently, so a link can arrive with no matching tag row. The honest
    // answer is to render nothing — never a blank badge, and never a badge
    // built from an id this user does not own.
    const { byNote, chips } = indexTags(tags, [
      { note_id: "n1", tag_id: "someone-elses-tag" },
    ]);
    expect(byNote.get("n1")).toBeUndefined();
    expect(chips.every((c) => c.count === 0)).toBe(true);
  });

  it("sorts a note's badges by name so a row does not reshuffle", () => {
    const { byNote } = indexTags(tags, [
      { note_id: "n1", tag_id: "t1" },
      { note_id: "n1", tag_id: "t2" },
    ]);
    expect(byNote.get("n1")?.map((t) => t.id)).toEqual(["legal", "pricing"]);
  });
});
